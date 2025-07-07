import { getUrl } from "aws-amplify/storage";
import { DatasetPrefix, QUERY_KEYS } from "../utilities/types";

export const getDocumentUrl = async (filePath: string, fileName: string) => {
    try {
        // Clean up the path to ensure proper formatting
        const cleanPath = filePath.startsWith("/") ? filePath.substring(1) : filePath;
        const prefix = DatasetPrefix[QUERY_KEYS.VDA];

        // Construct the full path to the file in S3
        const fullPath = `${cleanPath}${fileName}`;

        // Get the pre-signed URL
        const result = await getUrl({
            path: fullPath,
            options: {
                validateObjectExistence: true,
                expiresIn: 3600,
            },
        });

        return result.url.href.toString();
    } catch (error) {
        console.error(`Error getting URL for ${fileName}:`, error);
        return null;
    }
};
