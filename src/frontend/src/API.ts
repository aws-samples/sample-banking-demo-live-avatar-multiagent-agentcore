/* tslint:disable */
/* eslint-disable */
//  This file was automatically generated and should not be edited.

export type CreateChatInput = {
  userId?: string | null,
  email: string,
  human?: string | null,
  assistant?: string | null,
  id?: string | null,
};

export type ModelChatConditionInput = {
  userId?: ModelIDInput | null,
  email?: ModelStringInput | null,
  human?: ModelStringInput | null,
  assistant?: ModelStringInput | null,
  and?: Array< ModelChatConditionInput | null > | null,
  or?: Array< ModelChatConditionInput | null > | null,
  not?: ModelChatConditionInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelIDInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  size?: ModelSizeInput | null,
};

export enum ModelAttributeTypes {
  binary = "binary",
  binarySet = "binarySet",
  bool = "bool",
  list = "list",
  map = "map",
  number = "number",
  numberSet = "numberSet",
  string = "string",
  stringSet = "stringSet",
  _null = "_null",
}


export type ModelSizeInput = {
  ne?: number | null,
  eq?: number | null,
  le?: number | null,
  lt?: number | null,
  ge?: number | null,
  gt?: number | null,
  between?: Array< number | null > | null,
};

export type ModelStringInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  size?: ModelSizeInput | null,
};

export type Chat = {
  __typename: "Chat",
  userId?: string | null,
  email: string,
  human?: string | null,
  assistant?: string | null,
  id: string,
  createdAt: string,
  updatedAt: string,
};

export type UpdateChatInput = {
  userId?: string | null,
  email?: string | null,
  human?: string | null,
  assistant?: string | null,
  id: string,
};

export type DeleteChatInput = {
  id: string,
};

export type ModelChatFilterInput = {
  userId?: ModelIDInput | null,
  email?: ModelStringInput | null,
  human?: ModelStringInput | null,
  assistant?: ModelStringInput | null,
  id?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  and?: Array< ModelChatFilterInput | null > | null,
  or?: Array< ModelChatFilterInput | null > | null,
  not?: ModelChatFilterInput | null,
};

export type ModelChatConnection = {
  __typename: "ModelChatConnection",
  items:  Array<Chat | null >,
  nextToken?: string | null,
};

export enum ModelSortDirection {
  ASC = "ASC",
  DESC = "DESC",
}


export type ModelSubscriptionChatFilterInput = {
  email?: ModelSubscriptionStringInput | null,
  human?: ModelSubscriptionStringInput | null,
  assistant?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  and?: Array< ModelSubscriptionChatFilterInput | null > | null,
  or?: Array< ModelSubscriptionChatFilterInput | null > | null,
  userId?: ModelStringInput | null,
};

export type ModelSubscriptionStringInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  in?: Array< string | null > | null,
  notIn?: Array< string | null > | null,
};

export type ModelSubscriptionIDInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  in?: Array< string | null > | null,
  notIn?: Array< string | null > | null,
};

export type CreateChatMutationVariables = {
  input: CreateChatInput,
  condition?: ModelChatConditionInput | null,
};

export type CreateChatMutation = {
  createChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type UpdateChatMutationVariables = {
  input: UpdateChatInput,
  condition?: ModelChatConditionInput | null,
};

export type UpdateChatMutation = {
  updateChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type DeleteChatMutationVariables = {
  input: DeleteChatInput,
  condition?: ModelChatConditionInput | null,
};

export type DeleteChatMutation = {
  deleteChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type SendChatMutationVariables = {
  human: string,
};

export type SendChatMutation = {
  sendChat?: string | null,
};

export type GetChatQueryVariables = {
  id: string,
};

export type GetChatQuery = {
  getChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type ListChatsQueryVariables = {
  filter?: ModelChatFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListChatsQuery = {
  listChats?:  {
    __typename: "ModelChatConnection",
    items:  Array< {
      __typename: "Chat",
      userId?: string | null,
      email: string,
      human?: string | null,
      assistant?: string | null,
      id: string,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ChatByUserIdQueryVariables = {
  userId: string,
  sortDirection?: ModelSortDirection | null,
  filter?: ModelChatFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ChatByUserIdQuery = {
  chatByUserId?:  {
    __typename: "ModelChatConnection",
    items:  Array< {
      __typename: "Chat",
      userId?: string | null,
      email: string,
      human?: string | null,
      assistant?: string | null,
      id: string,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OnCreateChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
  userId?: string | null,
};

export type OnCreateChatSubscription = {
  onCreateChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
  userId?: string | null,
};

export type OnUpdateChatSubscription = {
  onUpdateChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
  userId?: string | null,
};

export type OnDeleteChatSubscription = {
  onDeleteChat?:  {
    __typename: "Chat",
    userId?: string | null,
    email: string,
    human?: string | null,
    assistant?: string | null,
    id: string,
    createdAt: string,
    updatedAt: string,
  } | null,
};
