/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import type { ApplicationStart } from '@kbn/core/public';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DataViewsService } from '@kbn/data-views-plugin/public';
import { getLensApiMock } from '../react_embeddable/mocks';
import {
  ActionFactoryContext,
  CollectConfigProps,
  OpenLogsInDiscoverDrilldown,
} from './open_logs_in_discover_drilldown';

describe('open logs in discover drilldown', () => {
  let drilldown: OpenLogsInDiscoverDrilldown;
  const originalOpen = window.open;
  const mockNavigateToUrl = jest.fn();

  // Prevent the JSDOM error about missing "window.open"
  beforeAll(() => {
    window.open = jest.fn();
  });

  beforeEach(() => {
    const mockDataViewsService = {
      find: jest.fn().mockResolvedValue([{ id: 'logs-apm-id', title: 'logs-apm*' }]),
      create: jest.fn().mockResolvedValue({ id: 'logs-apm-id', title: 'logs-apm*' }),
      get: jest.fn(),
    } as unknown as DataViewsService;

    drilldown = new OpenLogsInDiscoverDrilldown({
      locator: () => ({
        getRedirectUrl: jest.fn().mockResolvedValue('http://discover-url'),
        getLocation: jest.fn(),
        getUrl: jest.fn(),
        navigate: jest.fn(),
        id: 'DISCOVER_APP_LOCATOR',
      } as any),
      dataViews: () => mockDataViewsService,
      hasDiscoverAccess: () => true,
      application: () => ({
        navigateToUrl: mockNavigateToUrl,
      } as unknown as ApplicationStart),
    });
  });

  afterAll(() => {
    window.open = originalOpen;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should have correct display name', () => {
    expect(drilldown.getDisplayName()).toEqual('Open logs in Discover');
  });

  test('should have correct order', () => {
    expect(drilldown.order).toEqual(9);
  });

  test('should have correct icon', () => {
    expect(drilldown.euiIcon).toEqual('discoverApp');
  });

  test('should have correct id', () => {
    expect(drilldown.id).toEqual('OPEN_LOGS_IN_DISCOVER_DRILLDOWN');
  });

  test('should have default config', () => {
    expect(drilldown.createConfig()).toEqual({
      openInNewTab: true,
      fieldNames: ['@timestamp', 'log.level', 'message'],
      synchronizedFields: [],
      existsFields: [],
    });
  });

  test('config is always valid', () => {
    expect(drilldown.isConfigValid({ openInNewTab: true, fieldNames: [], synchronizedFields: [], existsFields: [] })).toEqual(true);
    expect(drilldown.isConfigValid({ openInNewTab: false, fieldNames: [], synchronizedFields: [], existsFields: [] })).toEqual(true);
  });

  test('renders config component', async () => {
    const Component = drilldown.CollectConfig;
    const props = {
      config: { openInNewTab: false, fieldNames: ['@timestamp'], synchronizedFields: [], existsFields: [] },
      onConfig: jest.fn(),
      context: {} as ActionFactoryContext,
    } as CollectConfigProps;

    render(<Component {...props} />);

    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByLabelText('Open in new tab')).toBeInTheDocument();
  });

  test('config component calls onConfig when switch is toggled', async () => {
    const Component = drilldown.CollectConfig;
    const onConfig = jest.fn();
    const props = {
      config: { openInNewTab: false, fieldNames: ['@timestamp'], synchronizedFields: [], existsFields: [] },
      onConfig,
      context: {} as ActionFactoryContext,
    } as CollectConfigProps;

    render(<Component {...props} />);

    await userEvent.click(screen.getByRole('switch'));

    expect(onConfig).toHaveBeenCalledWith({ openInNewTab: true, fieldNames: ['@timestamp'], synchronizedFields: [], existsFields: [] });
  });

  test('execute with openInNewTab true opens new window', async () => {
    const config = { openInNewTab: true, fieldNames: [], synchronizedFields: [], existsFields: [] };
    const context = {
      embeddable: getLensApiMock(),
      data: {},
      filters: [],
    };

    await drilldown.execute(config, context);

    expect(window.open).toHaveBeenCalledWith('http://discover-url', '_blank');
    expect(mockNavigateToUrl).not.toHaveBeenCalled();
  });

  test('execute with openInNewTab false navigates to URL', async () => {
    const config = { openInNewTab: false, fieldNames: [], synchronizedFields: [], existsFields: [] };
    const context = {
      embeddable: getLensApiMock(),
      data: {},
      filters: [],
    };

    await drilldown.execute(config, context);

    expect(window.open).not.toHaveBeenCalled();
    expect(mockNavigateToUrl).toHaveBeenCalledWith('http://discover-url');
  });

  test('getHref returns discover URL for logs-apm*', async () => {
    const config = { openInNewTab: true, fieldNames: [], synchronizedFields: [], existsFields: [] };
    const context = {
      embeddable: getLensApiMock(),
      data: {},
      filters: [],
    };

    const href = await drilldown.getHref(config, context);

    expect(href).toBe('http://discover-url');
  });
});
