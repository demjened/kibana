/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { APPLY_FILTER_TRIGGER } from '@kbn/data-plugin/public';
import type { ApplicationStart } from '@kbn/core/public';
import type { SerializableRecord } from '@kbn/utility-types';
import type { CollectConfigProps as CollectConfigPropsBase } from '@kbn/kibana-utils-plugin/public';
import type {
  UiActionsEnhancedDrilldownDefinition as Drilldown,
  UiActionsEnhancedBaseActionFactoryContext as BaseActionFactoryContext,
} from '@kbn/ui-actions-enhanced-plugin/public';
import { EuiFormRow, EuiSwitch, EuiFieldText } from '@elastic/eui';
import type { ApplyGlobalFilterActionContext } from '@kbn/unified-search-plugin/public';
import { i18n } from '@kbn/i18n';
import type { DataViewsService } from '@kbn/data-views-plugin/public';
import { apiIsOfType } from '@kbn/presentation-publishing';
import type { Filter, Query } from '@kbn/es-query';
import { fromKueryExpression, toKqlExpression } from '@kbn/es-query';
import { DOC_TYPE } from '../../common/constants';
import type { DiscoverAppLocator } from './open_in_discover_helpers';
import { LensApi } from '../react_embeddable/types';
import { isLensApi } from '../react_embeddable/type_guards';

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

// Helper function to check if a field should be kept for logs
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

  // Handle different node types
  switch (node.type) {
    case 'function':
      return filterFunctionNode(node, keptFields);
    case 'literal':
      // Keep literals as they might be values, not field names
      return node;
    case 'wildcard':
      // Keep wildcard nodes (like * in field: *)
      return node;
    default:
      return node;
  }
}

// Filter function nodes (like 'and', 'or', field operations)
function filterFunctionNode(node: any, keptFields: Set<string>): any {
  if (!node.function) return null;
  
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
      if (fieldName && shouldKeepField(fieldName)) {
        keptFields.add(fieldName); // Track this field for columns
        return node;
      }
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

interface OpenLogsInDiscoverDeps {
  locator: () => DiscoverAppLocator | undefined;
  dataViews: () => Pick<DataViewsService, 'get' | 'find' | 'create'>;
  hasDiscoverAccess: () => boolean;
  application: () => ApplicationStart;
}

export type ActionContext = ApplyGlobalFilterActionContext & {
  embeddable: LensApi;
};

export interface Config extends SerializableRecord {
  openInNewTab: boolean;
  fieldName?: string;
}

export type OpenLogsInDiscoverTrigger = typeof APPLY_FILTER_TRIGGER;

export type ActionFactoryContext = BaseActionFactoryContext & ActionContext;
export type CollectConfigProps = CollectConfigPropsBase<Config, ActionFactoryContext>;

export class OpenLogsInDiscoverDrilldown
  implements Drilldown<Config, ActionContext, ActionFactoryContext>
{
  public readonly id = 'OPEN_LOGS_IN_DISCOVER_DRILLDOWN';

  constructor(private readonly deps: OpenLogsInDiscoverDeps) {}

  public readonly order = 9;

  public readonly getDisplayName = () =>
    i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown', {
      defaultMessage: 'Open logs in Discover',
    });

  public readonly euiIcon = 'discoverApp';

  supportedTriggers(): OpenLogsInDiscoverTrigger[] {
    return [APPLY_FILTER_TRIGGER];
  }

  private readonly ReactCollectConfig: React.FC<CollectConfigProps> = ({ config, onConfig }) => {
    return (
      <>
        <EuiFormRow
          label={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNameConfig', {
            defaultMessage: 'Additional field to display',
          })}
          helpText={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNameHelpText', {
            defaultMessage: 'Specify an additional field name to include in the Discover columns (optional)',
          })}
        >
          <EuiFieldText
            placeholder={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNamePlaceholder', {
              defaultMessage: 'e.g., service.version',
            })}
            value={config.fieldName || ''}
            onChange={(e) => onConfig({ ...config, fieldName: e.target.value })}
            data-test-subj="openLogsInDiscoverDrilldownFieldName"
          />
        </EuiFormRow>
        <EuiFormRow hasChildLabel={false}>
          <EuiSwitch
            id="openInNewTab"
            name="openInNewTab"
            label={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.newTabConfig', {
              defaultMessage: 'Open in new tab',
            })}
            checked={config.openInNewTab}
            onChange={() => onConfig({ ...config, openInNewTab: !config.openInNewTab })}
            data-test-subj="openLogsInDiscoverDrilldownOpenInNewTab"
          />
        </EuiFormRow>
      </>
    );
  };

  public readonly CollectConfig = this.ReactCollectConfig;

  public readonly createConfig = () => ({
    openInNewTab: true,
    fieldName: '',
  });

  public readonly isConfigValid = (config: Config): config is Config => {
    return true;
  };

  // Helper function to find or create logs-apm* data view
  private async getOrCreateLogsDataView() {
    const dataViews = this.deps.dataViews();
    
    try {
      const existingDataViews = await dataViews.find('logs-apm*', 1);
      if (existingDataViews.length > 0) {
        return existingDataViews[0];
      } else {
        // Create a temporary data view for logs-apm*
        return await dataViews.create({
          title: 'logs-apm*',
          timeFieldName: '@timestamp',
        });
      }
    } catch (error) {
      console.warn('Could not create/find data view for logs-apm*:', error);
      throw error;
    }
  }

  public readonly isCompatible = async (config: Config, context: ActionContext) => {
    // This drilldown is compatible with any Lens visualization
    // as it navigates to logs regardless of the source data view
    return this.deps.hasDiscoverAccess() && apiIsOfType(context.embeddable, DOC_TYPE);
  };

  public readonly isConfigurable = (context: ActionFactoryContext) =>
    this.deps.hasDiscoverAccess() && apiIsOfType(context.embeddable, DOC_TYPE);

  public readonly getHref = async (config: Config, context: ActionContext) => {
    const locator = this.deps.locator();
    if (!locator) {
      throw new Error('Discover locator not available.');
    }

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

    console.log('OpenLogsInDiscoverDrilldown -> getHref()');
    console.log('lensFilters', lensFilters);
    console.log('lensTimeRange', lensTimeRange);
    console.log('lensQuery', lensQuery);
    console.log('filterFields', filterFields);

    try {
      const logsDataView = await this.getOrCreateLogsDataView();

      // Collect all field names we want to show as columns
      const discoveryColumns = new Set<string>();
      
      // Always include core log fields that are useful for analysis
      discoveryColumns.add('@timestamp');
      discoveryColumns.add('message');
      discoveryColumns.add('log.level');
      
      // Add configured field name if provided
      if (config.fieldName && config.fieldName.trim()) {
        discoveryColumns.add(config.fieldName.trim());
      }
      
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
      
      return await locator.getRedirectUrl({
        indexPatternId: logsDataView.id!,
        timeRange: lensTimeRange,
        filters: lensFilters,
        query: {
          language: 'kuery',
          query: combinedQuery,
        },
        columns: columnsArray,
      });
    } catch (error) {
      // Fallback to using the index pattern directly
      console.warn('Could not create/find data view for logs-apm*:', error);
      return await locator.getRedirectUrl({
        indexPatternId: 'logs-apm*',
        timeRange: lensTimeRange,
        filters: lensFilters,
        query: {
          language: 'kuery',
          query: 'log.level: *',
        },
      });
    }
  };

  public readonly execute = async (config: Config, context: ActionContext) => {
    const href = await this.getHref(config, context);
    
    if (config.openInNewTab) {
      window.open(href, '_blank');
    } else {
      // Navigate within the same tab
      const url = new URL(href, window.location.origin);
      await this.deps.application().navigateToUrl(url.toString());
    }
  };
}
