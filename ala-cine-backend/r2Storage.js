
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(fileBuffer, fileName, contentType) {
  const uploadParams = {
    Bucket: process.env.R2_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: contentType,
  };

  try {
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    return {
      success: true,
      fileName: fileName
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { uploadToR2 };
