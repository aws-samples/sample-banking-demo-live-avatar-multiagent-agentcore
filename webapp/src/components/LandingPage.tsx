import React from 'react'
import {ContentLayout, Header} from '@cloudscape-design/components'
import image from '../images/gen-ai-demo-in-progress.png'

export const LandingPage = () => {

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Gen AI Labs Demo - Description."
        >
                    Gen AI Labs Demo Name
        </Header>
      }
      //variant="awsui-experimental"
    >
      <div>
        <img src={image} alt='genaidemo' width='50%' height='50%'></img>
      </div>
    </ContentLayout>
  )
}
