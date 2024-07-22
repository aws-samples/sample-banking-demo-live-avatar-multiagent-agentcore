import React from 'react'
import { Button } from '@cloudscape-design/components'
import logo from '../../images/assistant.jpeg'
import './LoginStyles.css'
import {signInWithRedirect} from "aws-amplify/auth"; // Import the CSS file

const LoginPrompt = () => {

  return (
    <div className="login-page-container">
      <div className="login-form-container">
        <img src={logo} alt="Gen AI Labs Demo" className="logo-image" />
        <h1 className="gradient-text">Welcome to Gen AI Labs Demo</h1>
        <p className="gradient-text">Please sign in to access the demo.</p>
        <Button variant="primary" onClick={() => signInWithRedirect({provider: {custom: 'AmazonFederate'}})} fullWidth>
          Sign In
        </Button>
      </div>
    </div>
  )
}

export default LoginPrompt
