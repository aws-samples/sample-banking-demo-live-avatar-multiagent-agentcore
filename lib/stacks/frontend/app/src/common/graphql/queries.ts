/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./types";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const getMessages = /* GraphQL */ `query GetMessages($id: ID!) {
  getMessages(id: $id) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetMessagesQueryVariables,
  APITypes.GetMessagesQuery
>;
export const listMessages = /* GraphQL */ `query ListMessages(
  $filter: ModelMessagesFilterInput
  $limit: Int
  $nextToken: String
) {
  listMessages(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      userId
      message
      id
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListMessagesQueryVariables,
  APITypes.ListMessagesQuery
>;
export const chatByUserId = /* GraphQL */ `query ChatByUserId(
  $userId: ID!
  $sortDirection: ModelSortDirection
  $filter: ModelMessagesFilterInput
  $limit: Int
  $nextToken: String
) {
  chatByUserId(
    userId: $userId
    sortDirection: $sortDirection
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      userId
      message
      id
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ChatByUserIdQueryVariables,
  APITypes.ChatByUserIdQuery
>;
