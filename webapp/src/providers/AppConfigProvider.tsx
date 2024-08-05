// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
  demoName: PropTypes.string,
  children: PropTypes.element
}

export function AppConfigProvider({ webappConfig, children }:any) {

  const providerValue = {}

  return (
    // @ts-ignore
    <AppConfigContext.Provider value={providerValue}>
      {children}
    </AppConfigContext.Provider>
  )

}
