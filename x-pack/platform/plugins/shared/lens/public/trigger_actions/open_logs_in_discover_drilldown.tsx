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
import { EuiFormRow, EuiSwitch } from '@elastic/eui';
import type { ApplyGlobalFilterActionContext } from '@kbn/unified-search-plugin/public';
import { i18n } from '@kbn/i18n';
import type { DataViewsService } from '@kbn/data-views-plugin/public';
import { apiIsOfType } from '@kbn/presentation-publishing';
import { DOC_TYPE } from '../../common/constants';
import type { DiscoverAppLocator } from './open_in_discover_helpers';
import { LensApi } from '../react_embeddable/types';

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
    );
  };

  public readonly CollectConfig = this.ReactCollectConfig;

  public readonly createConfig = () => ({
    openInNewTab: true,
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

    try {
      const logsDataView = await this.getOrCreateLogsDataView();
      
      return await locator.getRedirectUrl({
        indexPatternId: logsDataView.id!,
        timeRange: {
          from: 'now-24h',
          to: 'now',
        },
        query: {
          language: 'kuery',
          query: 'log.level: *',
        },
      });
    } catch (error) {
      // Fallback to using the index pattern directly
      return await locator.getRedirectUrl({
        indexPatternId: 'logs-apm*',
        timeRange: {
          from: 'now-24h',
          to: 'now',
        },
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
