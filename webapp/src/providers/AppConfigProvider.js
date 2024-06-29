// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { useContext } from 'react'
import PropTypes from 'prop-types'

const AppConfigContext = React.createContext(null)

export function useAppConfig() {
  const config = useContext(AppConfigContext)

  if (!config) throw new Error('useAppConfig must be used within AppConfigProvider')

  return config
}

AppConfigProvider.propTypes = {
  webappConfig: PropTypes.object,
  children: PropTypes.element
}

export function AppConfigProvider({ webappConfig, children }) {

  // define config items here

  const providerValue = {
    
  }

  return (
    <AppConfigContext.Provider value={providerValue}>
      {children}
    </AppConfigContext.Provider>
  )

}
