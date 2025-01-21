/* tslint:disable */
/* eslint-disable */
//  This file was automatically generated and should not be edited.

export type CreateToDoInput = {
  id?: string | null,
  ownerID: string,
  title?: string | null,
  completed?: boolean | null,
};

export type ModelToDoConditionInput = {
  ownerID?: ModelIDInput | null,
  title?: ModelStringInput | null,
  completed?: ModelBooleanInput | null,
  and?: Array< ModelToDoConditionInput | null > | null,
  or?: Array< ModelToDoConditionInput | null > | null,
  not?: ModelToDoConditionInput | null,
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

export type ModelBooleanInput = {
  ne?: boolean | null,
  eq?: boolean | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
};

export type ToDo = {
  __typename: "ToDo",
  id: string,
  ownerID: string,
  title?: string | null,
  completed?: boolean | null,
  createdAt: string,
  updatedAt: string,
};

export type UpdateToDoInput = {
  id: string,
  ownerID?: string | null,
  title?: string | null,
  completed?: boolean | null,
};

export type DeleteToDoInput = {
  id: string,
};

export type CreateChatInput = {
  id?: string | null,
  userID: string,
  human: string,
  bot?: string | null,
  data?: string | null,
};

export type ModelChatConditionInput = {
  userID?: ModelIDInput | null,
  human?: ModelStringInput | null,
  bot?: ModelStringInput | null,
  data?: ModelStringInput | null,
  and?: Array< ModelChatConditionInput | null > | null,
  or?: Array< ModelChatConditionInput | null > | null,
  not?: ModelChatConditionInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type Chat = {
  __typename: "Chat",
  id: string,
  userID: string,
  human: string,
  bot?: string | null,
  data?: string | null,
  createdAt: string,
  updatedAt: string,
};

export type UpdateChatInput = {
  id: string,
  userID?: string | null,
  human?: string | null,
  bot?: string | null,
  data?: string | null,
};

export type DeleteChatInput = {
  id: string,
};

export type ModelToDoFilterInput = {
  id?: ModelIDInput | null,
  ownerID?: ModelIDInput | null,
  title?: ModelStringInput | null,
  completed?: ModelBooleanInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  and?: Array< ModelToDoFilterInput | null > | null,
  or?: Array< ModelToDoFilterInput | null > | null,
  not?: ModelToDoFilterInput | null,
};

export type ModelToDoConnection = {
  __typename: "ModelToDoConnection",
  items:  Array<ToDo | null >,
  nextToken?: string | null,
};

export type ModelChatFilterInput = {
  id?: ModelIDInput | null,
  userID?: ModelIDInput | null,
  human?: ModelStringInput | null,
  bot?: ModelStringInput | null,
  data?: ModelStringInput | null,
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


export type ModelSubscriptionToDoFilterInput = {
  id?: ModelSubscriptionIDInput | null,
  ownerID?: ModelSubscriptionIDInput | null,
  title?: ModelSubscriptionStringInput | null,
  completed?: ModelSubscriptionBooleanInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  and?: Array< ModelSubscriptionToDoFilterInput | null > | null,
  or?: Array< ModelSubscriptionToDoFilterInput | null > | null,
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

export type ModelSubscriptionBooleanInput = {
  ne?: boolean | null,
  eq?: boolean | null,
};

export type ModelSubscriptionChatFilterInput = {
  id?: ModelSubscriptionIDInput | null,
  userID?: ModelSubscriptionIDInput | null,
  human?: ModelSubscriptionStringInput | null,
  bot?: ModelSubscriptionStringInput | null,
  data?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  and?: Array< ModelSubscriptionChatFilterInput | null > | null,
  or?: Array< ModelSubscriptionChatFilterInput | null > | null,
};

export type ResolverLambdaMutationVariables = {
  args?: string | null,
};

export type ResolverLambdaMutation = {
  resolverLambda?: string | null,
};

export type CreateToDoMutationVariables = {
  input: CreateToDoInput,
  condition?: ModelToDoConditionInput | null,
};

export type CreateToDoMutation = {
  createToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type UpdateToDoMutationVariables = {
  input: UpdateToDoInput,
  condition?: ModelToDoConditionInput | null,
};

export type UpdateToDoMutation = {
  updateToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type DeleteToDoMutationVariables = {
  input: DeleteToDoInput,
  condition?: ModelToDoConditionInput | null,
};

export type DeleteToDoMutation = {
  deleteToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type CreateChatMutationVariables = {
  input: CreateChatInput,
  condition?: ModelChatConditionInput | null,
};

export type CreateChatMutation = {
  createChat?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
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
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
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
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type GetToDoQueryVariables = {
  id: string,
};

export type GetToDoQuery = {
  getToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type ListToDosQueryVariables = {
  filter?: ModelToDoFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListToDosQuery = {
  listToDos?:  {
    __typename: "ModelToDoConnection",
    items:  Array< {
      __typename: "ToDo",
      id: string,
      ownerID: string,
      title?: string | null,
      completed?: boolean | null,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type GetChatQueryVariables = {
  id: string,
};

export type GetChatQuery = {
  getChat?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
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
      id: string,
      userID: string,
      human: string,
      bot?: string | null,
      data?: string | null,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TodoByOwnerIDQueryVariables = {
  ownerID: string,
  sortDirection?: ModelSortDirection | null,
  filter?: ModelToDoFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type TodoByOwnerIDQuery = {
  todoByOwnerID?:  {
    __typename: "ModelToDoConnection",
    items:  Array< {
      __typename: "ToDo",
      id: string,
      ownerID: string,
      title?: string | null,
      completed?: boolean | null,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ChatsByUserIDQueryVariables = {
  userID: string,
  sortDirection?: ModelSortDirection | null,
  filter?: ModelChatFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ChatsByUserIDQuery = {
  chatsByUserID?:  {
    __typename: "ModelChatConnection",
    items:  Array< {
      __typename: "Chat",
      id: string,
      userID: string,
      human: string,
      bot?: string | null,
      data?: string | null,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OnTaskByOwnerIDSubscriptionVariables = {
  ownerID: string,
};

export type OnTaskByOwnerIDSubscription = {
  onTaskByOwnerID?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnChatByUserIdSubscriptionVariables = {
  userID: string,
};

export type OnChatByUserIdSubscription = {
  onChatByUserId?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnCreateToDoSubscriptionVariables = {
  filter?: ModelSubscriptionToDoFilterInput | null,
};

export type OnCreateToDoSubscription = {
  onCreateToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateToDoSubscriptionVariables = {
  filter?: ModelSubscriptionToDoFilterInput | null,
};

export type OnUpdateToDoSubscription = {
  onUpdateToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteToDoSubscriptionVariables = {
  filter?: ModelSubscriptionToDoFilterInput | null,
};

export type OnDeleteToDoSubscription = {
  onDeleteToDo?:  {
    __typename: "ToDo",
    id: string,
    ownerID: string,
    title?: string | null,
    completed?: boolean | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnCreateChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
};

export type OnCreateChatSubscription = {
  onCreateChat?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
};

export type OnUpdateChatSubscription = {
  onUpdateChat?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteChatSubscriptionVariables = {
  filter?: ModelSubscriptionChatFilterInput | null,
};

export type OnDeleteChatSubscription = {
  onDeleteChat?:  {
    __typename: "Chat",
    id: string,
    userID: string,
    human: string,
    bot?: string | null,
    data?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};
