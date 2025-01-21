get_chat_by_id = """
query GetChat($id: ID!) {
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
"""

get_chats_by_user_id = """
query ChatsByUserID(
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
"""

update_chat_by_id = """
mutation UpdateChat(
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
"""
