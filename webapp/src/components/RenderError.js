import React from 'react'
import Alert from '@cloudscape-design/components/alert'
import {Link} from 'react-router-dom'

function RenderError() {
  return (
    <Alert
      statusIconAriaLabel="Info"
      type="warning"
      header="Page not found"
    >
            The page you are trying to find does not exist. Head back to <Link href={'/'}>home page</Link>.
    </Alert>)
}

export default RenderError
