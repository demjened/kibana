/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createAction, IncompatibleActionError } from '@kbn/ui-actions-plugin/public';
import { EmbeddableApiContext } from '@kbn/presentation-publishing';
import type { DataViewsService } from '@kbn/data-views-plugin/public';
import { map } from 'rxjs';
import type { DiscoverAppLocator } from './open_in_discover_helpers';
import { LensApi } from '../react_embeddable/types';
import { isLensApi } from '../react_embeddable/type_guards';
import type { Filter, Query } from '@kbn/es-query';
import { fromKueryExpression, getKqlFieldNames, toKqlExpression } from '@kbn/es-query';


// Find or create a data view for logs-apm*
const getOrCreateLogsDataView = async (dataViews: Pick<DataViewsService, 'get' | 'find' | 'create'>) => {
  let logsDataView;
  try {
    const existingDataViews = await dataViews.find('logs-apm*', 1);
    if (existingDataViews.length > 0) {
      logsDataView = existingDataViews[0];
    } else {
      // Create a temporary data view for logs-apm*
      console.log('creating data view for logs-apm*');
      logsDataView = await dataViews.create({
        title: 'logs-apm*',
        timeFieldName: '@timestamp',
      });
    }
  } catch (error) {
    // If we can't create/find the data view, fall back to using the pattern directly
    console.warn('Could not create data view for logs-apm*:', error);
  }
  return logsDataView;
};

// Helper function to extract field information from structured filters
function extractFieldsFromFilters(filters: Filter[]) {
  const fieldInfo: Array<{ field: string; type: string; value?: any }> = [];
  
  filters.forEach(filter => {
    if (filter.meta?.key) {
      fieldInfo.push({
        field: filter.meta.key,
        type: filter.meta.type || 'unknown',
        value: filter.meta.params || filter.query,
      });
    }
  });
  
  return fieldInfo;
}

// Helper function to extract field names from KQL query string
function extractFieldsFromKQL(queryString: string) {
  if (!queryString || typeof queryString !== 'string') {
    return [];
  }
  
  try {
    const ast = fromKueryExpression(queryString);
    return getKqlFieldNames(ast);
  } catch (error) {
    console.warn('Failed to parse KQL query:', error);
    return [];
  }
}

// Helper function to check if a field should be kept
function shouldKeepField(fieldName: string): boolean {
  const allowedPatterns = [
    'service.name',
    /^labels\./,
    /^numeric_labels\./,
  ];
  
  return allowedPatterns.some(pattern => {
    if (typeof pattern === 'string') {
      return fieldName === pattern;
    }
    return pattern.test(fieldName);
  });
}

// Helper function to filter KQL query to only keep allowed fields
function filterKQLQuery(queryString: string): { filteredQuery: string; keptFields: string[] } {
  if (!queryString || typeof queryString !== 'string') {
    return { filteredQuery: '', keptFields: [] };
  }
  
  try {
    const ast = fromKueryExpression(queryString);
    const keptFields = new Set<string>();
    const filteredAst = filterASTNode(ast, keptFields);

    console.log('filteredAst', filteredAst);
    console.log('keptFields from query', Array.from(keptFields));
    
    // If filtering resulted in no valid conditions, return empty string
    if (!filteredAst) {
      return { filteredQuery: '', keptFields: Array.from(keptFields) };
    }
    
    // Use Kibana's built-in AST-to-KQL conversion
    return { 
      filteredQuery: toKqlExpression(filteredAst),
      keptFields: Array.from(keptFields)
    };
  } catch (error) {
    console.warn('Failed to filter KQL query:', error);
    return { filteredQuery: '', keptFields: [] };
  }
}

// Recursively filter AST nodes to keep only allowed fields
function filterASTNode(node: any, keptFields: Set<string>): any {
  if (!node) return null;

  console.log('filterASTNode -> node type:', node.type, 'value:', node.value, 'function:', node.function);
  
  // Handle different node types
  switch (node.type) {
    case 'function':
      return filterFunctionNode(node, keptFields);
    case 'literal':
      // Keep literals as they might be values, not field names
      return node;
    case 'wildcard':
      // Keep wildcard nodes (like * in field: *)
      console.log('filterASTNode -> keeping wildcard node:', node);
      return node;
    default:
      console.log('filterASTNode -> keeping unknown node type:', node.type);
      return node;
  }
}

// Filter function nodes (like 'and', 'or', field operations)
function filterFunctionNode(node: any, keptFields: Set<string>): any {
  if (!node.function) return null;

  console.log('filterFunctionNode -> node', node.function);
  
  switch (node.function) {
    case 'and':
    case 'or':
      // Filter child arguments and keep only valid ones
      const filteredArgs = node.arguments
        .map((arg: any) => filterASTNode(arg, keptFields))
        .filter((arg: any) => arg !== null);
      
      if (filteredArgs.length === 0) {
        return null;
      } else if (filteredArgs.length === 1) {
        // If only one argument left, return it directly (flatten)
        return filteredArgs[0];
      } else {
        return {
          ...node,
          arguments: filteredArgs,
        };
      }
      
    case 'is':
    case 'range':
      // These are field operations - check if field should be kept
      const fieldName = getFieldNameFromOperation(node);
      console.log('filterFunctionNode -> field operation', node.function, 'field:', fieldName);
      if (fieldName && shouldKeepField(fieldName)) {
        console.log('-> keeping field:', fieldName);
        keptFields.add(fieldName); // Track this field for columns
        return node;
      }
      console.log('-> filtering out field:', fieldName);
      return null;
      
    default:
      // For other functions, try to extract field name and check
      const field = getFieldNameFromOperation(node);
      if (field && shouldKeepField(field)) {
        keptFields.add(field); // Track this field for columns
        return node;
      }
      return null;
  }
}

// Extract field name from various operation types
function getFieldNameFromOperation(node: any): string | null {
  if (!node.arguments || node.arguments.length === 0) {
    return null;
  }
  
  // Field name is typically the first argument
  const firstArg = node.arguments[0];
  if (firstArg && firstArg.type === 'literal') {
    return firstArg.value;
  }
  
  return null;
}


// Shared function to build the discover URL for logs
async function buildLogsDiscoverUrl(
  context: EmbeddableApiContext,
  locator: DiscoverAppLocator,
  dataViews: Pick<DataViewsService, 'get' | 'find' | 'create'>
): Promise<string> {
  // Extract current filters and query from the Lens chart
  let lensFilters: Filter[] = [];
  let lensTimeRange = { from: 'now-24h', to: 'now' };
  let lensQuery: Query | undefined = undefined;
  
  if (isLensApi(context.embeddable)) {
    const viewArgs = context.embeddable.getViewUnderlyingDataArgs();
    if (viewArgs) {
      lensFilters = viewArgs.filters || [];
      lensTimeRange = viewArgs.timeRange || lensTimeRange;
      // Only handle regular Query type, not AggregateQuery
      if (viewArgs.query && 'query' in viewArgs.query) {
        lensQuery = viewArgs.query as Query;
      }
    }
  }

  // Extract field conditions from structured filters
  const filterFields = extractFieldsFromFilters(lensFilters);

  // Extract field conditions from KQL query
  const queryFields = lensQuery && typeof lensQuery.query === 'string' 
    ? extractFieldsFromKQL(lensQuery.query) 
    : [];

  console.log('--> buildLogsDiscoverUrl()');
  console.log('lensFilters', lensFilters);
  console.log('lensTimeRange', lensTimeRange);
  console.log('lensQuery', lensQuery);
  console.log('filterFields', filterFields);
  console.log('queryFields', queryFields);

  const logsDataView = await getOrCreateLogsDataView(dataViews);

  // Collect all field names we want to show as columns
  const discoveryColumns = new Set<string>();
  
  // Always include core log fields that are useful for analysis
  discoveryColumns.add('@timestamp');
  discoveryColumns.add('message');
  discoveryColumns.add('log.level');
  
  // Add field names from structured filters that are allowed
  filterFields.forEach(fieldInfo => {
    if (shouldKeepField(fieldInfo.field)) {
      discoveryColumns.add(fieldInfo.field);
    }
  });

  // Filter the Lens query to only keep allowed fields and collect field names
  let filteredLensQuery = '';
  if (lensQuery && typeof lensQuery.query === 'string' && lensQuery.query.trim()) {
    const result = filterKQLQuery(lensQuery.query);
    filteredLensQuery = result.filteredQuery;
    
    // Add field names from the query to our columns
    result.keptFields.forEach(field => discoveryColumns.add(field));
    
    console.log('Original query:', lensQuery.query);
    console.log('Filtered query:', filteredLensQuery);
  }
  
  // Combine the filtered Lens query with our logs-specific filter
  let combinedQuery = 'log.level: *';
  if (filteredLensQuery) {
    combinedQuery = `(${filteredLensQuery}) AND log.level: *`;
  }
  
  const columnsArray = Array.from(discoveryColumns);
  console.log('Discover columns:', columnsArray);

  // Use the Discover locator directly with the logs-apm* index pattern
  const discoverUrl = await locator?.getRedirectUrl({
    indexPatternId: logsDataView?.id || 'logs-apm*',
    timeRange: lensTimeRange,
    filters: lensFilters,
    query: {
      language: 'kuery',
      query: combinedQuery,
    },
    columns: columnsArray,
  });

  return discoverUrl || '';
}

const ACTION_OPEN_IN_DISCOVER = 'ACTION_OPEN_IN_DISCOVER';
const ACTION_OPEN_LOGS_IN_DISCOVER = 'ACTION_OPEN_LOGS_IN_DISCOVER';

export const getDiscoverHelpersAsync = async () => await import('../async_services');

export const createOpenInDiscoverAction = (
  locator: DiscoverAppLocator,
  dataViews: Pick<DataViewsService, 'get'>,
  hasDiscoverAccess: boolean
) => {
  const actionDefinition = {
    type: ACTION_OPEN_IN_DISCOVER,
    id: ACTION_OPEN_IN_DISCOVER,
    order: 20, // right before Inspect which is 19
    getIconType: () => 'discoverApp',
    getDisplayName: () => 'Explore in Discover',
    getHref: async (context: EmbeddableApiContext) => {
      const { getHref } = await getDiscoverHelpersAsync();
      return getHref({
        locator,
        dataViews,
        hasDiscoverAccess,
        ...context,
      });
    },
    isCompatible: async (context: EmbeddableApiContext) => {
      const { isCompatible } = await getDiscoverHelpersAsync();
      return await isCompatible({
        hasDiscoverAccess,
        locator,
        dataViews,
        embeddable: context.embeddable,
      });
    },
    couldBecomeCompatible: ({ embeddable }: EmbeddableApiContext) => {
      if (!typeof (embeddable as LensApi).canViewUnderlyingData$)
        throw new IncompatibleActionError();
      return hasDiscoverAccess && Boolean((embeddable as LensApi).canViewUnderlyingData$);
    },
    getCompatibilityChangesSubject: ({ embeddable }: EmbeddableApiContext) => {
      if (!typeof (embeddable as LensApi).canViewUnderlyingData$) return;
      return (embeddable as LensApi).canViewUnderlyingData$.pipe(map(() => undefined));
    },
    execute: async (context: EmbeddableApiContext) => {
      const { execute } = await getDiscoverHelpersAsync();
      return execute({ ...context, locator, dataViews, hasDiscoverAccess });
    },
  };

  return createAction<EmbeddableApiContext>(actionDefinition);
};

export const createOpenLogsInDiscoverAction = (
  locator: DiscoverAppLocator,
  dataViews: Pick<DataViewsService, 'get' | 'find' | 'create'>,
  hasDiscoverAccess: boolean
) => {
  const actionDefinition = {
    type: ACTION_OPEN_LOGS_IN_DISCOVER,
    id: ACTION_OPEN_LOGS_IN_DISCOVER,
    order: 21,
    getIconType: () => 'discoverApp',
    getDisplayName: () => 'Open logs in Discover',
    getHref: async (context: EmbeddableApiContext) => {
      return buildLogsDiscoverUrl(context, locator, dataViews);
    },
    isCompatible: async (context: EmbeddableApiContext) => {
      const { isCompatible } = await getDiscoverHelpersAsync();
      return await isCompatible({
        hasDiscoverAccess,
        locator,
        dataViews,
        embeddable: context.embeddable,
      });
    },
    couldBecomeCompatible: ({ embeddable }: EmbeddableApiContext) => {
      if (!typeof (embeddable as LensApi).canViewUnderlyingData$)
        throw new IncompatibleActionError();
      return hasDiscoverAccess && Boolean((embeddable as LensApi).canViewUnderlyingData$);
    },
    getCompatibilityChangesSubject: ({ embeddable }: EmbeddableApiContext) => {
      if (!typeof (embeddable as LensApi).canViewUnderlyingData$) return;
      return (embeddable as LensApi).canViewUnderlyingData$.pipe(map(() => undefined));
    },
    execute: async (context: EmbeddableApiContext) => {
      const discoverUrl = await buildLogsDiscoverUrl(context, locator, dataViews);
      
      if (discoverUrl) {
        window.open(discoverUrl, '_blank');
      }
    },
  };

  return createAction<EmbeddableApiContext>(actionDefinition);
};
