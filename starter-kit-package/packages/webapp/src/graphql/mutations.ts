/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedMutation<InputType, OutputType> = string & {
  __generatedMutationInput: InputType;
  __generatedMutationOutput: OutputType;
};

export const resolverLambda = /* GraphQL */ `mutation ResolverLambda($args: String) {
  resolverLambda(args: $args)
}
` as GeneratedMutation<
  APITypes.ResolverLambdaMutationVariables,
  APITypes.ResolverLambdaMutation
>;
export const createToDo = /* GraphQL */ `mutation CreateToDo(
  $input: CreateToDoInput!
  $condition: ModelToDoConditionInput
) {
  createToDo(input: $input, condition: $condition) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.CreateToDoMutationVariables,
  APITypes.CreateToDoMutation
>;
export const updateToDo = /* GraphQL */ `mutation UpdateToDo(
  $input: UpdateToDoInput!
  $condition: ModelToDoConditionInput
) {
  updateToDo(input: $input, condition: $condition) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.UpdateToDoMutationVariables,
  APITypes.UpdateToDoMutation
>;
export const deleteToDo = /* GraphQL */ `mutation DeleteToDo(
  $input: DeleteToDoInput!
  $condition: ModelToDoConditionInput
) {
  deleteToDo(input: $input, condition: $condition) {
    id
    ownerID
    title
    completed
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.DeleteToDoMutationVariables,
  APITypes.DeleteToDoMutation
>;
export const createChat = /* GraphQL */ `mutation CreateChat(
  $input: CreateChatInput!
  $condition: ModelChatConditionInput
) {
  createChat(input: $input, condition: $condition) {
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
` as GeneratedMutation<
  APITypes.CreateChatMutationVariables,
  APITypes.CreateChatMutation
>;
export const updateChat = /* GraphQL */ `mutation UpdateChat(
  $input: UpdateChatInput!
  $condition: ModelChatConditionInput
) {
  updateChat(input: $input, condition: $condition) {
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
` as GeneratedMutation<
  APITypes.UpdateChatMutationVariables,
  APITypes.UpdateChatMutation
>;
export const deleteChat = /* GraphQL */ `mutation DeleteChat(
  $input: DeleteChatInput!
  $condition: ModelChatConditionInput
) {
  deleteChat(input: $input, condition: $condition) {
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
` as GeneratedMutation<
  APITypes.DeleteChatMutationVariables,
  APITypes.DeleteChatMutation
>;
