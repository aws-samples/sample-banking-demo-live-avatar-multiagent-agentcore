import React from 'react'
import { Link } from '@cloudscape-design/components'
import { useOnFollow } from '../../hooks/use-on-follow'

export default function RouterLink(props: any) {
  const onFollow = useOnFollow()

  return <Link {...props} onFollow={onFollow} />
}