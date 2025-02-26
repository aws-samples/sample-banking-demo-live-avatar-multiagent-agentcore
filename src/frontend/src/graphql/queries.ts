/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const getChat = /* GraphQL */ `query GetChat($id: ID!) {
  getChat(id: $id) {
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
` as GeneratedQuery<APITypes.GetChatQueryVariables, APITypes.GetChatQuery>;
export const listChats = /* GraphQL */ `query ListChats(
  $filter: ModelChatFilterInput
  $limit: Int
  $nextToken: String
) {
  listChats(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      userId
      email
      human
      assistant
      id
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<APITypes.ListChatsQueryVariables, APITypes.ListChatsQuery>;
export const chatByUserId = /* GraphQL */ `query ChatByUserId(
  $userId: ID!
  $sortDirection: ModelSortDirection
  $filter: ModelChatFilterInput
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
      email
      human
      assistant
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
