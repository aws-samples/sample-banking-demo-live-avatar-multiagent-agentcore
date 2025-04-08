/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const onCreateChat = /* GraphQL */ `subscription OnCreateChat(
  $filter: ModelSubscriptionChatFilterInput
  $userId: String
) {
  onCreateChat(filter: $filter, userId: $userId) {
    userId
    email
    human
    assistant
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateChatSubscriptionVariables,
  APITypes.OnCreateChatSubscription
>;
export const onUpdateChat = /* GraphQL */ `subscription OnUpdateChat(
  $filter: ModelSubscriptionChatFilterInput
  $userId: String
) {
  onUpdateChat(filter: $filter, userId: $userId) {
    userId
    email
    human
    assistant
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateChatSubscriptionVariables,
  APITypes.OnUpdateChatSubscription
>;
export const onDeleteChat = /* GraphQL */ `subscription OnDeleteChat(
  $filter: ModelSubscriptionChatFilterInput
  $userId: String
) {
  onDeleteChat(filter: $filter, userId: $userId) {
    userId
    email
    human
    assistant
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteChatSubscriptionVariables,
  APITypes.OnDeleteChatSubscription
>;
