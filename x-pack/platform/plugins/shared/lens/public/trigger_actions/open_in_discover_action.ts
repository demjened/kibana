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
    getHref: async () => {
      // Find or create a data view for logs-apm*
      let logsDataView;
      try {
        const existingDataViews = await dataViews.find('logs-apm*', 1);
        console.log('existingDataViews', existingDataViews);
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
        console.log('logsDataView', logsDataView);
      } catch (error) {
        // If we can't create/find the data view, fall back to using the pattern directly
        console.warn('Could not create data view for logs-apm*:', error);
      }

      // Use the Discover locator directly with the logs-apm* index pattern
      const discoverUrl = await locator?.getRedirectUrl({
        indexPatternId: logsDataView?.id || 'logs-apm*',
        timeRange: {
          from: 'now-24h',
          to: 'now',
        },
      });

      return discoverUrl || '';
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
      // Find or create a data view for logs-apm*
      let logsDataView;
      try {
        const existingDataViews = await dataViews.find('logs-apm*', 1);
        if (existingDataViews.length > 0) {
          logsDataView = existingDataViews[0];
        } else {
          // Create a temporary data view for logs-apm*
          logsDataView = await dataViews.create({
            title: 'logs-apm*',
            timeFieldName: '@timestamp',
          });
        }
      } catch (error) {
        // If we can't create/find the data view, fall back to using the pattern directly
        console.warn('Could not create data view for logs-apm*:', error);
      }

      // Open Discover directly with the logs-apm* index pattern
      const discoverUrl = await locator?.getRedirectUrl({
        indexPatternId: logsDataView?.id || 'logs-apm*',
        timeRange: {
          from: 'now-24h',
          to: 'now',
        },
      });

      if (discoverUrl) {
        window.open(discoverUrl, '_blank');
      }
    },
  };

  return createAction<EmbeddableApiContext>(actionDefinition);
};
