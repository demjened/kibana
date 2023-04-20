/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useState } from 'react';

import { useActions, useValues } from 'kea';

import {
  EuiBadge,
  EuiButton,
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiPanel,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { FormattedMessage, FormattedHTMLMessage } from '@kbn/i18n-react';

import { docLinks } from '../../../../../shared/doc_links';

import { TextExpansionCalloutLogic } from './text_expansion_callout_logic';

export interface TextExpansionCallOutState {
  dismiss: () => void;
  isCreateButtonDisabled: boolean;
  isDismissable: boolean;
  show: boolean;
}

export interface TextExpansionCallOutProps {
  isDismissable?: boolean;
}

export const TEXT_EXPANSION_CALL_OUT_DISMISSED_KEY =
  'enterprise-search-text-expansion-callout-dismissed';

export const useTextExpansionCallOutData = ({
  isDismissable = false,
}: TextExpansionCallOutProps): TextExpansionCallOutState => {
  const { isCreateButtonDisabled } = useValues(TextExpansionCalloutLogic);
  const { createTextExpansionModel } = useActions(TextExpansionCalloutLogic);

  const [show, setShow] = useState<boolean>(() => {
    if (!isDismissable) return true;

    try {
      return localStorage.getItem(TEXT_EXPANSION_CALL_OUT_DISMISSED_KEY) !== 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TEXT_EXPANSION_CALL_OUT_DISMISSED_KEY, JSON.stringify(!show));
    } catch {
      return;
    }
  }, [show]);

  const dismiss = useCallback(() => {
    setShow(false);
  }, []);

  return {
    createTextExpansionModel,
    dismiss,
    isCreateButtonDisabled,
    isDismissable,
    show,
  };
};

const TextExpansionDismissButton = ({ dismiss }: Pick<TextExpansionCallOutState, 'dismiss'>) => {
  return (
    <EuiFlexItem grow={false}>
      <EuiButtonIcon
        aria-label={i18n.translate(
          'xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.dismissButton',
          { defaultMessage: 'Dismiss ELSER call out' }
        )}
        iconType="cross"
        onClick={dismiss}
      />
    </EuiFlexItem>
  );
};

const DeployModel = ({
  dismiss,
  isCreateButtonDisabled,
  isDismissable,
}: Pick<TextExpansionCallOutState, 'dismiss' | 'isCreateButtonDisabled' | 'isDismissable'>) => {
  const { createTextExpansionModel } = useActions(TextExpansionCalloutLogic);

  return (
    <EuiPanel color="success">
      <EuiFlexGroup direction="column" gutterSize="s">
        <EuiFlexGroup direction="row" gutterSize="s" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiBadge color="success">
              <FormattedMessage
                id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.titleBadge"
                defaultMessage="New"
              />
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem grow>
            <EuiTitle size="xs">
              <h4>
                <EuiText color="text">
                  <FormattedMessage
                    id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.title"
                    defaultMessage="Improve your results with ELSER"
                  />
                </EuiText>
              </h4>
            </EuiTitle>
          </EuiFlexItem>
          {isDismissable && (
            <EuiFlexItem grow={false}>
              <TextExpansionDismissButton dismiss={dismiss} />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
        <EuiFlexGroup direction="column">
          <EuiText>
            <FormattedHTMLMessage
              id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.body"
              defaultMessage="ELSER (Elastic Learned Sparse EncodeR) is our <strong>new trained machine learning model</strong> designed to efficiently use context in natural language queries. This model delivers better results than BM25 without further training on your data."
              tagName="p"
            />
          </EuiText>
          <EuiFlexGroup direction="row" gutterSize="s" alignItems="center">
            <EuiButton
              color="success"
              disabled={isCreateButtonDisabled}
              iconType="launch"
              onClick={() => createTextExpansionModel(undefined)}
            >
              {i18n.translate(
                'xpack.enterpriseSearch.content.indices.pipelines.addInferencePipelineModal.steps.fields.addMapping',
                {
                  defaultMessage: 'Deploy',
                }
              )}
            </EuiButton>
            <EuiLink target="_blank" href={docLinks.elser}>
              <FormattedMessage
                id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.learnMoreLink"
                defaultMessage="Learn more"
              />
            </EuiLink>
          </EuiFlexGroup>
        </EuiFlexGroup>
      </EuiFlexGroup>
    </EuiPanel>
  );
};

const ModelDownloadInProgress = ({
  dismiss,
  isDismissable,
}: Pick<TextExpansionCallOutState, 'dismiss' | 'isDismissable'>) => (
  <EuiPanel color="success">
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem grow>
        <EuiFlexGroup direction="row" gutterSize="s" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiIcon type="clock" />
          </EuiFlexItem>
          <EuiFlexItem grow>
            <EuiTitle size="xs">
              <h4>
                <FormattedMessage
                  id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.deployingTitle"
                  defaultMessage="Your ELSER model is deploying."
                />
              </h4>
            </EuiTitle>
          </EuiFlexItem>
          {isDismissable && (
            <EuiFlexItem grow={false}>
              <TextExpansionDismissButton dismiss={dismiss} />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      </EuiFlexItem>
      <EuiFlexItem grow>
        <EuiText>
          <FormattedMessage
            id="xpack.enterpriseSearch.content.index.pipelines.textExpansionCallOut.deployingBody"
            defaultMessage="You can continue creating your pipeline with other uploaded models in the meantime."
          />
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
  </EuiPanel>
);

const ModelDownloaded = ({
  dismiss,
  isDismissable,
}: Pick<TextExpansionCallOutState, 'dismiss' | 'isDismissable'>) => (
  <EuiPanel color="success">
    <EuiFlexGroup direction="column" gutterSize="s">
      {isDismissable && (
        <EuiFlexItem grow={false}>
          <TextExpansionDismissButton dismiss={dismiss} />
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  </EuiPanel>
);

export const TextExpansionCallOut: React.FC<TextExpansionCallOutProps> = (props) => {
  const { dismiss, isDismissable, show } = useTextExpansionCallOutData(props);
  const { isCreateButtonDisabled, isModelDownloadInProgress, isModelDownloaded } =
    useValues(TextExpansionCalloutLogic);

  if (!show) return null;

  if (!!isModelDownloadInProgress) {
    return <ModelDownloadInProgress dismiss={dismiss} isDismissable={isDismissable} />;
  } else if (!!isModelDownloaded) {
    return <ModelDownloaded dismiss={dismiss} isDismissable={isDismissable} />;
  }

  return (
    <DeployModel
      dismiss={dismiss}
      isDismissable={isDismissable}
      isCreateButtonDisabled={isCreateButtonDisabled}
    />
  );
};
