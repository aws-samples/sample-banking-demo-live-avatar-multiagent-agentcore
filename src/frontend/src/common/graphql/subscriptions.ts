/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./types";
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const onCreateMessages = /* GraphQL */ `subscription OnCreateMessages(
  $filter: ModelSubscriptionMessagesFilterInput
  $userId: String
) {
  onCreateMessages(filter: $filter, userId: $userId) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateMessagesSubscriptionVariables,
  APITypes.OnCreateMessagesSubscription
>;
export const onUpdateMessages = /* GraphQL */ `subscription OnUpdateMessages(
  $filter: ModelSubscriptionMessagesFilterInput
  $userId: String
) {
  onUpdateMessages(filter: $filter, userId: $userId) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateMessagesSubscriptionVariables,
  APITypes.OnUpdateMessagesSubscription
>;
export const onDeleteMessages = /* GraphQL */ `subscription OnDeleteMessages(
  $filter: ModelSubscriptionMessagesFilterInput
  $userId: String
) {
  onDeleteMessages(filter: $filter, userId: $userId) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteMessagesSubscriptionVariables,
  APITypes.OnDeleteMessagesSubscription
>;
