import { RestAPI } from '@aws-amplify/api-rest'
import { Auth } from '@aws-amplify/auth'
import * as util from 'util'

// EXAMPLE IMPLEMENTATION

export const listItems = async (limit = 10) => {
  try {
    const token = (await Auth.currentSession()).getIdToken().getJwtToken()
    console.log('token:', token)

    let allDemos = []
    let nextToken = null
    let iterationCount = 0
    const maxIterations = 100 // Set a limit on the number of iterations
    const timeout = 60000 // Set a timeout of 60 seconds (1 minute)
    const startTime = Date.now()

    do {
      const response = await RestAPI.get('demoAPI', '/getExample', {
        headers: {
          Authorization: token,
        },
        queryStringParameters: {
          limit,
          nextToken,
        },
      })

      allDemos = [...allDemos, ...response.data.demos]
      nextToken = response.data.nextToken

      iterationCount++
      if (iterationCount >= maxIterations) {
        console.error('getListDemos: Reached max iterations, stopping the loop.')
        break
      }

      if (Date.now() - startTime > timeout) {
        console.error('getListDemos: Reached timeout, stopping the loop.')
        break
      }
    } while (nextToken)

    return allDemos
  } catch (error) {
    if (error.message === 'Network Error') {
      console.error('List Demos Error: Network error. Check your API Gateway allowed origins.', error)
      throw new Error('There was a network error. If the issue is CORS policy, check your API Gateway allowed origins.')
    } else if (error.response) {
      console.error(util.format('List Demos Error: API responded with status code %d. Error message: %s', error.response.status, error.response.data.message), error)      
      throw new Error(`API Error: ${error.response.data.message}`)
    } else if (error.request) {
      console.error('List Demos Error: No response received from the API.', error)
      throw new Error('API request error: No response received.')
    } else {
      console.error('List Demos Error: Unexpected error occurred.', error)
      throw new Error('Unexpected error occurred.')
    }
  }
}