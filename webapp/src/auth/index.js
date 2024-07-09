import { Auth } from '@aws-amplify/auth'

export const getAuthentication = async () => {
  try {
    const result = await Auth.currentAuthenticatedUser()
    return cognitoUserToAuthenticationInfo(result)
  } catch (error) {
    console.error(error)
    throw error
  }
}

const cognitoUserToAuthenticationInfo = (cognitoUser) => {
  const { username, signInUserSession } = cognitoUser
  const { idToken } = signInUserSession
  const { payload: idTokenPayload } = idToken

  return {
    userId: username.split('_')[1],
    email: idTokenPayload.email,
    name: idTokenPayload.name,
    groups: idTokenPayload['cognito:groups'],
    posixGroups: idTokenPayload['custom:posix'],
  }
}

export const signOut = async () => {
  try {
    clearCookies()
    // Construct the logout URL with the necessary query parameters
    const logoutUrl = new URL('https://midway-auth.amazon.com/logout')
    // Redirect the user to the logout URL
    window.location.href = logoutUrl.toString()
    await Auth.signOut()
      
    window.location.reload()
  } catch (error) {
    console.error('Error signing out:', error)
  }
}

const clearCookies = () => {
  const cookies = document.cookie.split(';')
  const currentDomain = window.location.hostname
  
  for (const element of cookies) {
    const cookie = element
    const eqPos = cookie.indexOf('=')
    const name = eqPos > -1 ? cookie.slice(0, eqPos) : cookie
    const domain = `;domain=${currentDomain}`
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;${domain}`
  }
}

export { AmplifyConfig } from './AmplifyConfig'