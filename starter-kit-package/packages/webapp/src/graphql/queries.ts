/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const getToDo = /* GraphQL */ `query GetToDo($id: ID!) {
  getToDo(id: $id) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedQuery<APITypes.GetToDoQueryVariables, APITypes.GetToDoQuery>;
export const listToDos = /* GraphQL */ `query ListToDos(
  $filter: ModelToDoFilterInput
  $limit: Int
  $nextToken: String
) {
  listToDos(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      id
      ownerID
      title
      completed
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<APITypes.ListToDosQueryVariables, APITypes.ListToDosQuery>;
export const getChat = /* GraphQL */ `query GetChat($id: ID!) {
  getChat(id: $id) {
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
` as GeneratedQuery<APITypes.GetChatQueryVariables, APITypes.GetChatQuery>;
export const listChats = /* GraphQL */ `query ListChats(
  $filter: ModelChatFilterInput
  $limit: Int
  $nextToken: String
) {
  listChats(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      id
      userID
      human
      bot
      data
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<APITypes.ListChatsQueryVariables, APITypes.ListChatsQuery>;
export const todoByOwnerID = /* GraphQL */ `query TodoByOwnerID(
  $ownerID: ID!
  $sortDirection: ModelSortDirection
  $filter: ModelToDoFilterInput
  $limit: Int
  $nextToken: String
) {
  todoByOwnerID(
    ownerID: $ownerID
    sortDirection: $sortDirection
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      id
      ownerID
      title
      completed
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TodoByOwnerIDQueryVariables,
  APITypes.TodoByOwnerIDQuery
>;
export const chatsByUserID = /* GraphQL */ `query ChatsByUserID(
  $userID: ID!
  $sortDirection: ModelSortDirection
  $filter: ModelChatFilterInput
  $limit: Int
  $nextToken: String
) {
  chatsByUserID(
    userID: $userID
    sortDirection: $sortDirection
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      id
      userID
      human
      bot
      data
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ChatsByUserIDQueryVariables,
  APITypes.ChatsByUserIDQuery
>;
