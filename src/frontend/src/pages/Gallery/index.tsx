import {
    Box,
    Cards,
    ContentLayout,
    Header,
    SpaceBetween,
    Spinner,
} from "@cloudscape-design/components";
import { useEffect, useState } from "react";
import Layout from "../../common/components/Layout";
import { getObjects } from "./storage";

interface Photo {
    name: string;
    url: string;
}

const Gallery = () => {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        const loadPhotos = async () => {
            setPhotos(await getObjects());
        };
        loadPhotos();
    }, []);

    return (
        <Layout
            content={
                <ContentLayout header={<Header variant="h2">Gallery</Header>}>
                    {photos.length === 0 ? (
                        <Box textAlign="center" padding="l">
                            <Spinner size="large" />
                        </Box>
                    ) : (
                        <SpaceBetween size="l">
                            <Cards
                                items={photos}
                                cardDefinition={{
                                    header: (item) => item.name,
                                    sections: [
                                        {
                                            content: (item) => (
                                                <img
                                                    src={item.url}
                                                    alt={item.name}
                                                    style={{
                                                        width: "100%",
                                                        height: "400px",
                                                        objectFit: "cover",
                                                    }}
                                                />
                                            ),
                                        },
                                    ],
                                }}
                            />
                        </SpaceBetween>
                    )}
                </ContentLayout>
            }
        />
    );
};

export default Gallery;
