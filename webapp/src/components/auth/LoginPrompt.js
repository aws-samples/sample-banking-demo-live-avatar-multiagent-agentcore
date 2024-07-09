import React from 'react'
import { AmplifyConfig } from '../../auth/AmplifyConfig'
import { Button } from '@cloudscape-design/components'
import logo from '../../images/assistant.jpeg'
import './LoginStyles.css' // Import the CSS file

const LoginPrompt = () => {
  const { domain, redirectSignIn, responseType } = AmplifyConfig.Auth.oauth
  const userPoolWebClientId = AmplifyConfig.Auth.userPoolWebClientId

  const loginUrl = `https://${domain}/login?redirect_uri=${redirectSignIn}&response_type=${responseType}&client_id=${userPoolWebClientId}`

  const handleLogin = () => {
    window.location.href = loginUrl
  }

  return (
    <div className="login-page-container">
      <div className="login-form-container">
        <img src={logo} alt="Gen AI Labs Demo" className="logo-image" />
        <h1 className="gradient-text">Welcome to Gen AI Labs Demo</h1>
        <p className="gradient-text">Please sign in to access the demo.</p>
        <Button variant="primary" onClick={handleLogin} fullWidth>
          Sign In
        </Button>
      </div>
    </div>
  )
}

export default LoginPrompt
