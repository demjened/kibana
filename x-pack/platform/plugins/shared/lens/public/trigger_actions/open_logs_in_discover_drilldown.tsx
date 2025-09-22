/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect } from 'react';
import { APPLY_FILTER_TRIGGER } from '@kbn/data-plugin/public';
import type { ApplicationStart } from '@kbn/core/public';
import type { SerializableRecord } from '@kbn/utility-types';
import type { CollectConfigProps as CollectConfigPropsBase } from '@kbn/kibana-utils-plugin/public';
import type {
  UiActionsEnhancedDrilldownDefinition as Drilldown,
  UiActionsEnhancedBaseActionFactoryContext as BaseActionFactoryContext,
} from '@kbn/ui-actions-enhanced-plugin/public';
import { EuiFormRow, EuiSwitch, EuiFieldText, EuiButton, EuiButtonIcon, EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiCheckbox } from '@elastic/eui';
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

// Helper function to extract initial field names from chart context
function extractInitialFieldNames(context: ActionFactoryContext): string[] {
  const fieldNames = new Set<string>();
  
  if (isLensApi(context.embeddable)) {
    const viewArgs = context.embeddable.getViewUnderlyingDataArgs();
    if (viewArgs) {
      // Extract fields from structured filters
      const lensFilters = viewArgs.filters || [];
      const filterFields = extractFieldsFromFilters(lensFilters);
      filterFields.forEach(fieldInfo => {
        // Only include fields that are allowed for logs and not core fields
        if (shouldKeepField(fieldInfo.field) && 
            !['@timestamp', 'message', 'log.level'].includes(fieldInfo.field)) {
          fieldNames.add(fieldInfo.field);
        }
      });

      // Extract fields from KQL query
      const lensQuery = viewArgs.query;
      if (lensQuery && 'query' in lensQuery && 
          typeof lensQuery.query === 'string' && lensQuery.query.trim()) {
        const result = filterKQLQuery(lensQuery.query);
        result.keptFields.forEach(field => {
          // Only include fields that are allowed for logs and not core fields
          if (shouldKeepField(field) && 
              !['@timestamp', 'message', 'log.level'].includes(field)) {
            fieldNames.add(field);
          }
        });
      }
    }
  }
  
  return Array.from(fieldNames);
}

// Helper function to extract filter criteria for synchronized fields only
function extractSynchronizedFilters(filters: Filter[], synchronizedFields: string[]): Filter[] {
  return filters.filter(filter => {
    if (filter.meta?.key) {
      return synchronizedFields.includes(filter.meta.key);
    }
    return false;
  });
}

// Helper function to build KQL query with only synchronized fields
function buildSynchronizedKQLQuery(queryString: string, synchronizedFields: string[]): string {
  if (!queryString || typeof queryString !== 'string' || synchronizedFields.length === 0) {
    return '';
  }
  
  try {
    const ast = fromKueryExpression(queryString);
    const filteredAst = filterASTForSynchronizedFields(ast, synchronizedFields);
    
    if (!filteredAst) {
      return '';
    }
    
    return toKqlExpression(filteredAst);
  } catch (error) {
    console.warn('Failed to build synchronized KQL query:', error);
    return '';
  }
}

// Recursively filter AST nodes to keep only synchronized fields
function filterASTForSynchronizedFields(node: any, synchronizedFields: string[]): any {
  if (!node) return null;

  switch (node.type) {
    case 'function':
      return filterFunctionNodeForSynchronizedFields(node, synchronizedFields);
    case 'literal':
    case 'wildcard':
      return node;
    default:
      return node;
  }
}

// Filter function nodes for synchronized fields
function filterFunctionNodeForSynchronizedFields(node: any, synchronizedFields: string[]): any {
  if (!node.function) return null;
  
  switch (node.function) {
    case 'and':
    case 'or':
      const filteredArgs = node.arguments
        .map((arg: any) => filterASTForSynchronizedFields(arg, synchronizedFields))
        .filter((arg: any) => arg !== null);
      
      if (filteredArgs.length === 0) {
        return null;
      } else if (filteredArgs.length === 1) {
        return filteredArgs[0];
      } else {
        return {
          ...node,
          arguments: filteredArgs,
        };
      }
      
    case 'is':
    case 'range':
    default:
      // Check if this field operation should be kept
      const fieldName = getFieldNameFromOperation(node);
      if (fieldName && synchronizedFields.includes(fieldName)) {
        return node;
      }
      return null;
  }
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
  fieldNames: string[];
  synchronizedFields: string[]; // Fields that should carry over filter criteria
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

  public readonly euiIcon = 'logsApp';

  supportedTriggers(): OpenLogsInDiscoverTrigger[] {
    return [APPLY_FILTER_TRIGGER];
  }

  private readonly ReactCollectConfig: React.FC<CollectConfigProps> = ({ config, onConfig, context }) => {
    // Auto-populate fields from chart context when creating a new drilldown
    useEffect(() => {
      // Only populate if fieldNames is empty (new drilldown) and context is available
      if (config.fieldNames.length === 0 && context) {
        const initialFields = extractInitialFieldNames(context);
        if (initialFields.length > 0) {
          // Mark auto-populated fields as synchronized by default
          onConfig({ 
            ...config, 
            fieldNames: initialFields,
            synchronizedFields: initialFields 
          });
        }
      }
    }, []); // Empty dependency array - only run once when component mounts

    const addField = () => {
      const newFieldNames = [...config.fieldNames, ''];
      // New fields are not synchronized by default
      onConfig({ ...config, fieldNames: newFieldNames });
    };

    const removeField = (indexToRemove: number) => {
      const newFieldNames = config.fieldNames.filter((_, index) => index !== indexToRemove);
      const fieldToRemove = config.fieldNames[indexToRemove];
      const newSynchronizedFields = config.synchronizedFields.filter(field => field !== fieldToRemove);
      onConfig({ ...config, fieldNames: newFieldNames, synchronizedFields: newSynchronizedFields });
    };

    const updateField = (index: number, value: string) => {
      const newFieldNames = [...config.fieldNames];
      const oldFieldName = newFieldNames[index];
      newFieldNames[index] = value;
      
      // Update synchronized fields array if the field name changed
      const newSynchronizedFields = config.synchronizedFields.map(field => 
        field === oldFieldName ? value : field
      );
      
      onConfig({ ...config, fieldNames: newFieldNames, synchronizedFields: newSynchronizedFields });
    };

    const toggleSynchronization = (fieldName: string, checked: boolean) => {
      let newSynchronizedFields;
      if (checked) {
        // Add to synchronized fields if not already present
        newSynchronizedFields = config.synchronizedFields.includes(fieldName) 
          ? config.synchronizedFields 
          : [...config.synchronizedFields, fieldName];
      } else {
        // Remove from synchronized fields
        newSynchronizedFields = config.synchronizedFields.filter(field => field !== fieldName);
      }
      onConfig({ ...config, synchronizedFields: newSynchronizedFields });
    };

    return (
      <>
        <EuiFormRow
          label={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNamesConfig', {
            defaultMessage: 'Additional fields to display',
          })}
          helpText={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNamesHelpText', {
            defaultMessage: 'Specify additional field names to include in the Discover columns. Fields from your chart\'s filters and query are automatically included.',
          })}
        >
          <div>
            {config.fieldNames.map((fieldName, index) => (
              <EuiFlexGroup key={index} alignItems="center" gutterSize="s">
                <EuiFlexItem>
                  <EuiFieldText
                    placeholder={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.fieldNamePlaceholder', {
                      defaultMessage: 'e.g., service.version',
                    })}
                    value={fieldName}
                    onChange={(e) => updateField(index, e.target.value)}
                    data-test-subj={`openLogsInDiscoverDrilldownFieldName-${index}`}
                  />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiCheckbox
                    id={`sync-${index}`}
                    label={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.synchronizeLabel', {
                      defaultMessage: 'Sync filters',
                    })}
                    checked={config.synchronizedFields.includes(fieldName)}
                    onChange={(e) => toggleSynchronization(fieldName, e.target.checked)}
                    data-test-subj={`openLogsInDiscoverDrilldownSyncField-${index}`}
                  />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonIcon
                    iconType="cross"
                    color="danger"
                    onClick={() => removeField(index)}
                    aria-label={i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.removeFieldAriaLabel', {
                      defaultMessage: 'Remove field',
                    })}
                    data-test-subj={`openLogsInDiscoverDrilldownRemoveField-${index}`}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            ))}
            <EuiSpacer size="s" />
            <EuiButton
              iconType="plus"
              size="s"
              onClick={addField}
              data-test-subj="openLogsInDiscoverDrilldownAddField"
            >
              {i18n.translate('xpack.lens.app.openLogsInDiscoverDrilldown.addFieldButton', {
                defaultMessage: 'Add field',
              })}
            </EuiButton>
          </div>
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
    fieldNames: [],
    synchronizedFields: [],
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

    // Extract only synchronized filters and field conditions
    const synchronizedFilters = extractSynchronizedFilters(lensFilters, config.synchronizedFields);
    const filterFields = extractFieldsFromFilters(synchronizedFilters);

    console.log('OpenLogsInDiscoverDrilldown -> getHref()');
    console.log('config.synchronizedFields', config.synchronizedFields);
    console.log('lensFilters', lensFilters);
    console.log('synchronizedFilters', synchronizedFilters);
    console.log('lensTimeRange', lensTimeRange);
    console.log('lensQuery', lensQuery);
    console.log('filterFields', filterFields);

    // Build KQL query with only synchronized fields
    let synchronizedKQLQuery = '';
    if (lensQuery && typeof lensQuery.query === 'string' && lensQuery.query.trim()) {
      synchronizedKQLQuery = buildSynchronizedKQLQuery(lensQuery.query, config.synchronizedFields);
      
      console.log('Original query:', lensQuery.query);
      console.log('Synchronized query:', synchronizedKQLQuery);
    }
    
    // Combine the synchronized Lens query with our logs-specific filter
    let combinedQuery = 'log.level: *';
    if (synchronizedKQLQuery) {
      combinedQuery = `(${synchronizedKQLQuery}) AND log.level: *`;
    }

    try {
      const logsDataView = await this.getOrCreateLogsDataView();

      // Collect all field names we want to show as columns
      const discoveryColumns = new Set<string>();
      
      // Always include core log fields that are useful for analysis
      discoveryColumns.add('@timestamp');
      discoveryColumns.add('message');
      discoveryColumns.add('log.level');
      
      // Add configured field names if provided
      config.fieldNames.forEach(fieldName => {
        if (fieldName && fieldName.trim()) {
          discoveryColumns.add(fieldName.trim());
        }
      });
      
      // Add field names from structured filters that are allowed
      filterFields.forEach(fieldInfo => {
        if (shouldKeepField(fieldInfo.field)) {
          discoveryColumns.add(fieldInfo.field);
        }
      });

      
      const columnsArray = Array.from(discoveryColumns);
      console.log('Discover columns:', columnsArray);
      
      // Configure column widths for better log viewing
      const gridColumns: Record<string, { width?: number }> = {};
      
      // Set default widths for specific log fields
      if (columnsArray.includes('log.level')) {
        gridColumns['log.level'] = { width: 80 };
      }
      if (columnsArray.includes('service.name')) {
        gridColumns['service.name'] = { width: 150 };
      }
      
      return await locator.getRedirectUrl({
        indexPatternId: logsDataView.id!,
        timeRange: lensTimeRange,
        filters: synchronizedFilters,
        query: {
          language: 'kuery',
          query: combinedQuery,
        },
        columns: columnsArray,
        grid: Object.keys(gridColumns).length > 0 ? { columns: gridColumns } : undefined,
      });
    } catch (error) {
      // Fallback to using the index pattern directly
      console.warn('Could not create/find data view for logs-apm*:', error);
      // Configure column widths for fallback case too
      const gridColumns: Record<string, { width?: number }> = {};
      gridColumns['log.level'] = { width: 80 };
      // Note: service.name may not be available in fallback, but include it anyway
      gridColumns['service.name'] = { width: 150 };
      
      return await locator.getRedirectUrl({
        indexPatternId: 'logs-apm*',
        timeRange: lensTimeRange,
        filters: synchronizedFilters,
        query: {
          language: 'kuery',
          query: combinedQuery,
        },
        grid: { columns: gridColumns },
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
