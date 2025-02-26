import {
    Box,
    Cards,
    ContentLayout,
    Header,
    SpaceBetween,
    Spinner,
} from "@cloudscape-design/components";
import { useEffect, useState } from "react";
import { getPhotos } from "../services/storage";

interface Photo {
    path: string;
    url: string;
}

const Gallery = () => {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        const loadPhotos = async () => {
            setPhotos(await getPhotos());
        };
        loadPhotos();
    }, []);

    return (
        <ContentLayout
            header={
                <Header
                    variant="h2"
                    description="Someone please build me a better gallery UI for this page."
                >
                    Gallery
                </Header>
            }
        >
            {photos.length === 0 ? (
                <Box textAlign="center" padding="l">
                    <Spinner size="large" />
                </Box>
            ) : (
                <SpaceBetween size="l">
                    <Cards
                        items={photos}
                        cardDefinition={{
                            header: (item) => item.path,
                            sections: [
                                {
                                    content: (item) => (
                                        <img
                                            src={item.url}
                                            alt={item.path}
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
    );
};

export default Gallery;
