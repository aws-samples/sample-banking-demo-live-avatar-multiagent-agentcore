import { getUrl, list } from "aws-amplify/storage";

export const getPhotos = async () => {
    const photosList = await list({
        path: "",
    });
    const photos = await Promise.all(
        photosList.items.map(async (item) => {
            const urlString = (
                await getUrl({
                    path: item.path,
                })
            ).url.toString();
            return {
                path: item.path,
                url: urlString,
            };
        })
    );
    return photos;
};
