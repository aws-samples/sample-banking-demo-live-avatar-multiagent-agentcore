/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const onTaskByOwnerID = /* GraphQL */ `subscription OnTaskByOwnerID($ownerID: ID!) {
  onTaskByOwnerID(ownerID: $ownerID) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnTaskByOwnerIDSubscriptionVariables,
  APITypes.OnTaskByOwnerIDSubscription
>;
export const onChatByUserId = /* GraphQL */ `subscription OnChatByUserId($userID: ID!) {
  onChatByUserId(userID: $userID) {
    id
    userID
    human
    bot
    data
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnChatByUserIdSubscriptionVariables,
  APITypes.OnChatByUserIdSubscription
>;
export const onCreateToDo = /* GraphQL */ `subscription OnCreateToDo($filter: ModelSubscriptionToDoFilterInput) {
  onCreateToDo(filter: $filter) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateToDoSubscriptionVariables,
  APITypes.OnCreateToDoSubscription
>;
export const onUpdateToDo = /* GraphQL */ `subscription OnUpdateToDo($filter: ModelSubscriptionToDoFilterInput) {
  onUpdateToDo(filter: $filter) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateToDoSubscriptionVariables,
  APITypes.OnUpdateToDoSubscription
>;
export const onDeleteToDo = /* GraphQL */ `subscription OnDeleteToDo($filter: ModelSubscriptionToDoFilterInput) {
  onDeleteToDo(filter: $filter) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteToDoSubscriptionVariables,
  APITypes.OnDeleteToDoSubscription
>;
export const onCreateChat = /* GraphQL */ `subscription OnCreateChat($filter: ModelSubscriptionChatFilterInput) {
  onCreateChat(filter: $filter) {
    id
    userID
    human
    bot
    data
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateChatSubscriptionVariables,
  APITypes.OnCreateChatSubscription
>;
export const onUpdateChat = /* GraphQL */ `subscription OnUpdateChat($filter: ModelSubscriptionChatFilterInput) {
  onUpdateChat(filter: $filter) {
    id
    userID
    human
    bot
    data
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateChatSubscriptionVariables,
  APITypes.OnUpdateChatSubscription
>;
export const onDeleteChat = /* GraphQL */ `subscription OnDeleteChat($filter: ModelSubscriptionChatFilterInput) {
  onDeleteChat(filter: $filter) {
    id
    userID
    human
    bot
    data
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteChatSubscriptionVariables,
  APITypes.OnDeleteChatSubscription
>;
