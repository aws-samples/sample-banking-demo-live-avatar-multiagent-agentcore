/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./types";
type GeneratedMutation<InputType, OutputType> = string & {
  __generatedMutationInput: InputType;
  __generatedMutationOutput: OutputType;
};

export const testMessage = /* GraphQL */ `mutation TestMessage($message: String!) {
  testMessage(message: $message)
}
` as GeneratedMutation<
  APITypes.TestMessageMutationVariables,
  APITypes.TestMessageMutation
>;
export const createMessages = /* GraphQL */ `mutation CreateMessages(
  $input: CreateMessagesInput!
  $condition: ModelMessagesConditionInput
) {
  createMessages(input: $input, condition: $condition) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.CreateMessagesMutationVariables,
  APITypes.CreateMessagesMutation
>;
export const updateMessages = /* GraphQL */ `mutation UpdateMessages(
  $input: UpdateMessagesInput!
  $condition: ModelMessagesConditionInput
) {
  updateMessages(input: $input, condition: $condition) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.UpdateMessagesMutationVariables,
  APITypes.UpdateMessagesMutation
>;
export const deleteMessages = /* GraphQL */ `mutation DeleteMessages(
  $input: DeleteMessagesInput!
  $condition: ModelMessagesConditionInput
) {
  deleteMessages(input: $input, condition: $condition) {
    userId
    message
    id
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.DeleteMessagesMutationVariables,
  APITypes.DeleteMessagesMutation
>;
