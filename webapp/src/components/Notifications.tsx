// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { useEffect, useState }  from 'react'
import Flashbar from '@cloudscape-design/components/flashbar'

import {NotificationItem, useAppState} from '../providers/AppStateProvider'

const Notifications = () => {
  const { notificationItem } = useAppState()
  const [items, setItems] = useState([] as NotificationItem[])

  useEffect(() => {
    if (notificationItem.type) { // Flashbar will allow the render of an empty object
      const notificationID = new Date().toString()
      notificationItem.id = notificationID
      notificationItem.onDismiss = () => {
        console.log(notificationID)
        setItems(items =>
          items.filter(item => item.id !== notificationID)
        )
      }
      setItems(items => [...items, notificationItem])
    }
  }, [notificationItem])

  return (
    //@ts-ignore
    <Flashbar stackItems items={items} />
  )
}

export default Notifications