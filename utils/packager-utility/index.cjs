#!/usr/bin/env node
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");
const starterKitFilePath = "../../starter-kit-package"
const outputZipPath = '../../release/starter-kit-package.zip';

// avoid adding these files or folders to the zipping utility
const restrictedFileNames = [
  '.DS_Store',
  "node_modules",
  "dist",
  "cdk.out",
  "cdk.context.json",
  ".graphqlconfig.yml",
  "package-lock.json",
  "hydration",
  ".env",
  "CHANGELOG.md"
];

// default project-config.json file
const defaultProjectConfig = {
  "projectName": "PROJECT-IDENTIFIER",
  "gitlabGroup": "genai-labs/demo-assets",
  "gitlabProject": "GITLAB-PROJECT-SLUG",
  "codeArtifact": false,
  "codePipeline": true,
  "midway": true,
  "account": {
    "dev": {
      "number": "AWS_ACCOUNT_ID",
      "region": "AWS_REGION"
    },
    "prod": {
      "number": "AWS_ACCOUNT_ID",
      "region": "AWS_REGION"
    }
  }
}

function isAllowedPath(path) {
  let result = true
  restrictedFileNames.forEach(r => {
    if (path.includes(r)) {
      console.warn(`⚠️ skipping restricted file/folder name ${r} found in ${path}`);
      result = false
    }
  })

  return result
}

async function zipFolder() {
  if (!fs.existsSync(starterKitFilePath)) {
    console.error("starter-kit-package folder not found");
    process.exit(1);
  }

  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath)
    console.log("Deleted existing zip file ✅");
  }

  console.log("packaging the starter kit ... ⏳");

  const zip = new JSZip();

  async function addFilesToZip(currentPath, zipPath) {


    // return if  the file name contains any of the restricted files
    if (!isAllowedPath(currentPath))
      return

    const files = await fs.promises.readdir(currentPath);
    console.log("🚀 Adding item:", currentPath)
    // console.log("🚀 Files:", files)

    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stat = await fs.promises.stat(filePath);

      if (stat.isFile() && isAllowedPath(filePath)) {
        // replace the project-config.json file with default values
        if (filePath.includes("project-config.json")) {
          // Create a buffer from the string
          const buffer = Buffer.from(JSON.stringify(defaultProjectConfig, null, 4), 'utf-8');
          console.log("✏️ Writing default config file ✅  ");

          zip.file(path.join(zipPath, file), buffer);
        } else {
          const fileContent = await fs.promises.readFile(filePath);
          zip.file(path.join(zipPath, file), fileContent);
        }
      } else if (stat.isDirectory()) {
        await addFilesToZip(filePath, path.join(zipPath, file));
      }
    }
  }

  await addFilesToZip(starterKitFilePath, "");
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fs.promises.writeFile(outputZipPath, zipBuffer);
}


zipFolder()
  .then(() => console.log("packaging the starter kit completed ✅"))
  .catch(err => console.error("Error zipping:", err));
