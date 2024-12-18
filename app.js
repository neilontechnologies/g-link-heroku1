const express = require('express');
const cors = require('cors');
const app = express();

const { google } = require('googleapis');
const { Readable } = require('stream');

const { OAuth2 } = google.auth;
const SCOPE = ['https://www.googleapis.com/auth/drive'];

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());
const bodyParser = require('body-parser');
app.use(bodyParser.json())

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Use to authenticate heroku access key
app.use((req, res, next) => {
  const apiKey = process.env.API_KEY;
  const { heroku_api_key } = req.body;

  if(heroku_api_key === apiKey){
    next(); 
  } else{
    res.status(403).send('Forbidden: Invalid Heroku API Key');
  }
});

// This service is used to upload salesforce files and attachments into Google Drive
app.post('/uploadsalesforcefile', async (req, res) => {
  try{
    // Get all headers from apex
    const {
      google_drive_client_id,
      google_drive_secret_id,
      sf_client_id,
      sf_client_secret,
      sf_username,
      sf_password,
      google_drive_file_title,
      sf_parent_id,
      google_drive_folder_key,
      google_drive_bucket_name,
      sf_content_document_id,
      sf_file_size,
      sf_file_id,
      sf_content_document_link_id,
      sf_namespace,
      sf_delete_file,
      sf_create_log,
      g_file,
      google_drive_file_meta_data,
      google_drive_refresh_token,
      google_drive_folder_id
  } = req.body;

  // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
  res.send(`Heroku service to migrate Salesforce File has been started successfully.`);

  // Get salesforce response
  const migrateSalesforceResult = migrateSalesforce(sf_file_id, google_drive_client_id, google_drive_secret_id, google_drive_refresh_token, sf_client_id, sf_client_secret, sf_username, sf_password, google_drive_bucket_name, google_drive_folder_key, google_drive_file_title, sf_file_size, 
    sf_content_document_id, sf_parent_id, sf_content_document_link_id, sf_namespace, sf_delete_file, sf_create_log, g_file, google_drive_file_meta_data, google_drive_folder_id);
  } catch(error){
    console.log(error);
  }
});

// This methiod is used to handle all combine methods
const migrateSalesforce = async (sfFileId, googleDriveAccessKey, googleDriveSecretKey, googleDriveRefreshToken, sfClientId, sfClientSecret, sfUsername, sfPassword, googleDriveBucketName, googleDriveFolderKey, googleDriveFileTitle, sfFileSize, sfContentDocumentId, sfParentId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileMetadata, googleDriveFolderId) =>{
  let salesforceAccessToken;
  let instanceUrl;
  
  // Get access token of salesforce
  const salesforceTokenResponse = await getSalesforceToken(sfClientId, sfClientSecret, sfUsername, sfPassword);

  // Check if access token and instance URL are available or not
  if(!salesforceTokenResponse.accessToken || !salesforceTokenResponse.instanceUrl){
    return;
  } else {
    salesforceAccessToken = salesforceTokenResponse.accessToken;
    instanceUrl = salesforceTokenResponse.instanceUrl
  }

  // Get access token authetication with google drive
  const googleDriveAccessToken = await createOAuthClient(googleDriveAccessKey, googleDriveSecretKey, googleDriveRefreshToken);

  // Check google access token is null or not
  if(googleDriveAccessToken == null){
    const createFileMigrationLogResult =  createFileMigrationLog(salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, 'ERROR', sfNamespace);
  }

  // Check required parameters
  if(sfFileSize &&  sfFileId && (googleDriveFolderKey || sfParentId) && googleDriveFileTitle){
    // Get salesforce file information 
    const getSalesforceFileResult = await getSalesforceFile(salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);
    
    if(googleDriveFolderId != null){
      // Prepare google drive file path
      const googleDriveFilePath = googleDriveFolderKey + '/' + googleDriveFileTitle

      // Upload file into google drive  
      const response = await uploadFileToGoogleDrive(googleDriveAccessToken, getSalesforceFileResult, googleDriveFolderId, googleDriveFileTitle, gFile, sfNamespace, salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfCreateLog, googleDriveFileMetadata);

      // Check response
      if(response.status == 200){
        if(response && response.data && response.data.id){
          // Get google drive file id
          const googleDriveFileId = response.data.id;

          // Create g file record if file is successfully uploaded into google drive
          const createGFilesInSalesforceResult = await createGFilesInSalesforce(salesforceAccessToken, instanceUrl, googleDriveBucketName, googleDriveFilePath, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileId);
        }
      }
    }else if (googleDriveFolderId != null) {
      // Prepare google drive folder path
      const googleDriveFolderPath = googleDriveBucketName + '/' + googleDriveFolderKey;

      // Create google drive file path
      const googleDriveFilePath = googleDriveFolderKey + '/' + googleDriveFileTitle

      // Create google drive folder using google drive folder path
      const {createGoogleDriveFolderResult} = await createGoogleDriveFolder(salesforceAccessToken, instanceUrl, googleDriveFolderPath, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);

      // Check folder is created or not
      if(createGoogleDriveFolderResult != null && createGoogleDriveFolderResult.code == 200 && createGoogleDriveFolderResult.data != null){

        // Get google drive folder id
        const googleDriveFolderId = createGoogleDriveFolderResult.data.split('/').pop();

        // Upload file into google drive 
        const response = await uploadFileToGoogleDrive(googleDriveAccessToken, getSalesforceFileResult, googleDriveFolderId, googleDriveFileTitle, gFile, sfNamespace, salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfCreateLog, googleDriveFileMetadata);

        // Check response
        if(response.status == 200){
          if(response && response.data && response.data.id){
            // Get google drive file id
            const googleDriveFileId = response.data.id;

            // Create g file record if file is successfully uploaded into google drive
            const createGFilesInSalesforceResult = await createGFilesInSalesforce(salesforceAccessToken, instanceUrl, googleDriveBucketName, googleDriveFilePath, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileId);
          }
        }
      }
    } else{
      // Check if google drive folder id is available for parentId or not
      const { getRecordHomeFolderResult } = await getRecordHomeFolder(salesforceAccessToken, instanceUrl, sfParentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);

      // Check reponse
      if(getRecordHomeFolderResult.sObjects != null && getRecordHomeFolderResult.sObjects.length > 0){

        // Create googlde drive file path
        const googleDriveFilePath = getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Google_Folder_Path__c'] + '/' + googleDriveFileTitle;

        // Check google drive folder id is available or not
        if(getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Google_Drive_Folder_Id__c'] != null){

          // Upload file into google drive 
          const response = await uploadFileToGoogleDrive(googleDriveAccessToken, getSalesforceFileResult, getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Google_Drive_Folder_Id__c'], googleDriveFileTitle, gFile, sfNamespace, salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfCreateLog, googleDriveFileMetadata);

          // Check response
          if(response.status == 200){
            if(response && response.data && response.data.id){
              // Get google drive file id
              const googleDriveFileId = response.data.id;

              // Create g file record if file is successfully uploaded into google drive
              const createGFilesInSalesforceResult = await createGFilesInSalesforce(salesforceAccessToken, instanceUrl, googleDriveBucketName, googleDriveFilePath, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileId);
            }
          }
        } else {
          // Create google drive folder path
          const googleDriveFolderPath = getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Bucket_Name__c'] + '/'+ getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Google_Folder_Path__c'];

          // Create google drive folder busing google drive folder path
          const {createGoogleDriveFolderResult} = await createGoogleDriveFolder(salesforceAccessToken, instanceUrl, googleDriveFolderPath, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);
          // TODO createGoogleDriveFolderResult

          //  Check response
          if(createGoogleDriveFolderResult != null && createGoogleDriveFolderResult.code == 200 && createGoogleDriveFolderResult.data != null){

            // Get google drive folder id
            const googleDriveFolderId = createGoogleDriveFolderResult.data.split('/').pop();

            // Upload file in google drive
            const response = await uploadFileToGoogleDrive(googleDriveAccessToken, getSalesforceFileResult, googleDriveFolderId, googleDriveFileTitle, gFile, sfNamespace, salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfCreateLog, googleDriveFileMetadata);

            // Check response
            if(response.status == 200){
              if(response && response.data && response.data.id){
                // Get google drive file id
                const googleDriveFileId = response.data.id;

                // Create g file record if file is successfully uploaded into google drive
                const createGFilesInSalesforceResult = await createGFilesInSalesforce(salesforceAccessToken, instanceUrl, googleDriveBucketName, googleDriveFilePath, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileId);
              }
            }
          } else {
            // Prepare failure rason with error message of API
            const failureReason = 'Your request to create Google Drive Folders failed. ERROR: ' + createGoogleDriveFolderResult.message;
            
            if(sfCreateLog){
              // Create File Migration Logs 
              const createFileMigrationLogResult =  createFileMigrationLog(salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
            }
          }
        }
      } else{
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create G-Folder for the record failed. ERROR: ' + getRecordHomeFolderResult.message ;

          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult = await createFileMigrationLog(salesforceAccessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
      }
    } 
  } else {
    if(sfCreateLog){
      // Prepare failure rason with error message of API
      const failureReason = 'Salesforce File Id, Salesforce File Size, Google Drive Bucket Name, or Google Drive Folder Path is missing.';

      // Create File Migration Logs
      const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      throw new Error(failureReason);
    }
  }
}

// This method is used to get access token of Salesforce org and instance url of the org
const getSalesforceToken = (sfClientId, sfClientSecret, sfUsername, sfPassword) => {
  return new Promise((resolve, reject) => {
    const postData = `grant_type=password&client_id=${sfClientId}&client_secret=${sfClientSecret}&username=${sfUsername}&password=${sfPassword}`;
    const xhr = new XMLHttpRequest();

    xhr.open('POST', 'https://login.salesforce.com/services/oauth2/token', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

    xhr.onreadystatechange = function(){
      if(xhr.readyState === 4){
        const response = JSON.parse(xhr.responseText);
        if(xhr.status === 200){
          resolve({
            accessToken: response.access_token,
            instanceUrl: response.instance_url
          });
        } else {
          reject(new Error('We are not able to get the Salesforce Authentication Token. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid. ERROR: ' + response.error_description));
        }
      }
    };

    xhr.onerror = function(e){
      reject(new Error('We are not able to get the Salesforce Authentication Token. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid. ERROR: ' + e.message));
    };

    xhr.send(postData);
  });
};

// This method is used to get salesforce file information with the help of access token of that org, URL, provided salesforce file id  
const getSalesforceFile = async (accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog) => {
  var url;
  // Prepare url of attachments or content document
  if(sfFileId.startsWith('00P')){
    url = `${instanceUrl}/services/data/v58.0/sobjects/Attachment/${sfFileId}/Body`;
  } else {
    url = `${instanceUrl}/services/data/v58.0/sobjects/ContentVersion/${sfFileId}/VersionData`;
  }
  
  // To authenticate salesforce
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // Returns the response status code
    if(!response.ok){
      throw new Error(`We are not able to fetch the Salesforce File Content. ERROR: ${response.statusText}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch(error){
    // Create File Migration Logs
    if(sfCreateLog){
      const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, error.message, sfNamespace);
      console.error(error);
      throw error;
    }
  }
};

// This method used to create record home folder for parent id
const getRecordHomeFolder = async (accessToken, instanceUrl, sfParentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let url;

    // Check namespace is available or not
    if(sfNamespace){
      url = `${instanceUrl}/services/apexrest/NEILON2/GLink/v1/recordfolder/${sfParentId}`;
    } else{
      url = `${instanceUrl}/services/apexrest/GLink/v1/recordfolder/${sfParentId}`;
    }

    xhr.open('GET', url, true); 
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');  

    xhr.onload = function() {
      if (xhr.readyState === 4) {
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          resolve({
            getRecordHomeFolderResult: response
          });  // Resolve the Promise on success
        } else {
          // Prepare error messsage
          const failureReason = 'Your request to create G-Folder for the record failed. ERROR: ' + response[0].message;

          // Check sf create log is true or false
          if (sfCreateLog) {
            // Ensure the log is created before rejecting the promise
            createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
        }
      }
    };

    xhr.onerror = function(e) {
      // Prepare failure rason with error message of API
      const failureReason = 'Your request to create G-Folder for the record failed. ERROR: ' + e;

      // Check sf create log is true or false
      if(sfCreateLog){
        // Create File Migration Logs
        const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      }

      // Handle network error
      reject(new Error(failureReason));
    };
    xhr.send();
  });
};

// This method used to create G-Files record in salesforce
const createGoogleDriveFolder = async (accessToken, instanceUrl, googleDriveFolderPath, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog) => {
  return new Promise((resolve, reject) => {
    let url;
    const xhr = new XMLHttpRequest();

    //Check namespace is available or not
    if(sfNamespace != ''){
      url = `${instanceUrl}/services/apexrest/NEILON2/GLink/v1/creategoogledrivefolders/`;
    } else {
      url = `${instanceUrl}/services/apexrest/GLink/v1/creategoogledrivefolders/`;
    }
    
    // Prepare body
    var textBody = googleDriveFolderPath;

    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'text/plain');
    
    xhr.onload = function() {
      if (xhr.readyState === 4) {
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          resolve({
            createGoogleDriveFolderResult: response
          });  // Resolve the Promise on success
        } else {
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create Google Drive Folder failed. ERROR: ' + response[0].message;

          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
        }
      }
    };
    
    // Send the request with the JSON body
    xhr.send(textBody);
  });
};

// This method used to create G-Files record in salesforce
const createGFilesInSalesforce = async (accessToken, instanceUrl, googleDriveBucketName, googleDriveFilePath, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileId) => {
  return new Promise((resolve, reject) => {
    let url;
    const xhr = new XMLHttpRequest();

    // Check namespace is available or not
    if(sfNamespace != ''){
      url = `${instanceUrl}/services/apexrest/NEILON2/GLink/v1/creategfiles/`;
    } else {
      console.log('TRUE');
      url = `${instanceUrl}/services/apexrest/GLink/v1/creategfiles/`;
    }
    
    var body = [];

    // Check g-file is availbe or not
    if(!gFile){
      gFile = {};
    }

    gFile[sfNamespace + 'Bucket_Name__c'] = googleDriveBucketName;
    gFile[sfNamespace + 'Google_File_Path__c'] = googleDriveFilePath;
    gFile[sfNamespace + 'Size__c'] = sfFileSize;
    gFile[sfNamespace + 'Content_Document_Id__c'] = sfContentDocumentId;
    gFile[sfNamespace + 'Export_Attachment_Id__c'] = sfFileId;
    gFile[sfNamespace + 'Google_Drive_File_Id__c'] = googleDriveFileId;
    body.push(gFile);

    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    if(sfDeleteFile){
      xhr.setRequestHeader('delete-salesforce-file', 'true');
    }

    // Handle the response
    xhr.onload = function() {
      if (xhr.readyState === 4) {  
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          if(response.sObjects && response.sObjects.length > 0 && !response.sObjects[0].Id){
            // Prepare failure rason with error message of API
            const failureReason = 'Your request to create G-Files in Salesforce failed. ERROR: ' + response.sObjects[0][sfNamespace + 'Description__c'];

            // Check sf create log is true or false
            if(sfCreateLog){
              // Create File Migration Logs
              const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
            }
          } else{
            resolve(response);
          }
        } else {
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create G-Files in Salesforce failed. ERROR: ' + response[0].message;
          
          // Check sf create log is true or false
          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }

          reject(new Error(failureReason));
        }
      }
    };

    // Handle network errors
    xhr.onerror = function(e) {
      // Prepare failure rason with error message of API
      const failureReason = 'Your request to create G-Files in Salesforce failed. ERROR: ' + e;

      // Check sf create log is true or false
      if(sfCreateLog){
        // Create File Migration Logs
        const createFileMigrationLogResult = createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      }
      reject(new Error(failureReason));
    };

    // Send the request with the JSON body
    xhr.send(JSON.stringify(body));
  });
};

// This method used to create Salesforce File Migration Log record in salesforce
const createFileMigrationLog = (accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace) => {
  return new Promise((resolve, reject) => {
    let url;
    const xhr = new XMLHttpRequest();
    if(sfNamespace != ''){
      url = `${instanceUrl}/services/apexrest/NEILON2/GLink/v1/createmigrationlog/`;
    } else {
      url = `${instanceUrl}/services/apexrest/GLink/v1/createmigrationlog/`;
    }
    
    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    // Create body
    const body = {}

    // Check file type is attachment or content document link
    if (sfFileId.startsWith('00P')) {
        body.SalesforceFileId = sfFileId;
    } else {
        body.SalesforceFileId = sfContentDocumentLinkId;
    }
    body.FailureReason = failureReason;

    // Handle the response
    xhr.onload = function() {
      if (xhr.readyState === 4) {  
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          resolve(response);
        } else {
          //reject(new Error('Your request to create Salesforce Files Migration log in Salesforce failed. ERROR: ' + xhr.statusText));
        }
      }
    };

    // Handle network errors
    xhr.onerror = function(e) {
      //reject(new Error('Your request to create Salesforce Files Migration log in Salesforce failed. ERROR: ' + e));
    };

    // Send the request with the JSON body
    xhr.send(JSON.stringify(body));
  });
};

// This function is used to create authentication with google drive
async function createOAuthClient(clientId, clientSecret, refreshToken) {
  const oauth2Client = new OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// This function will upload the desired file to google drive folder
async function uploadFileToGoogleDrive(authClient, buffer, googleDriveFolderId, googleDriveFileTitle, gFile, sfNamespace, accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfCreateLog, googleDriveFileMetadata) {
  return new Promise((resolve, reject) => {
    // Authenticate with google
    const drive = google.drive({ version: 'v3', auth: authClient });
 
    // Get meta tags
    var fileMetaTags = {};
    const metatype = 'google';

    // Create google drive file metadata
    if(googleDriveFileMetadata){
      // Prepare google drive metadata map
      Object.entries(googleDriveFileMetadata).forEach(([filedAPIName, value]) => {
        var fieldAPI = filedAPIName;
        var metaFieldAPI = 'x-' + metatype + '-meta-' + fieldAPI.toLowerCase();
        if (googleDriveFileMetadata[fieldAPI] !== undefined && googleDriveFileMetadata[fieldAPI] !== null) {
          fileMetaTags[metaFieldAPI] = googleDriveFileMetadata[fieldAPI].toString();
        } else {
            fileMetaTags[metaFieldAPI] = '';
        }
      })
    }

    // Prepare metadata to store in google drive file
    const googleDriveFolderIds = [];
    googleDriveFolderIds.push(googleDriveFolderId);

    const fileMetaData = {
      name: googleDriveFileTitle,
      parents: googleDriveFolderIds, 
      mimeType: gFile[sfNamespace + 'Content_Type__c'],
      properties: fileMetaTags
    };
    
    // Create a readable stream from the buffer
    const bufferStream = Readable.from(buffer);

    // Prepare media for google drive file
    const media = {
      body: bufferStream,
      mimeType: gFile[sfNamespace + 'Content_Type__c'],
    };

    // Method to upload file in google drive
    drive.files.create(
      {
        resource: fileMetaData,
        media,
        fields: 'id',
      },
      async (error, file) => {
        if(error){
          // Check sf create log is true or false
          if(sfCreateLog){
            // Prepare error message
            const failureReason = 'Your request to upload file in Google Drive has failed' + error;

            // Create File Migration Logs
            const createFileMigrationLogResult = createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
          return;
        }

        if (gFile[sfNamespace + 'Public_On_Google__c']) {
          try {
            await drive.permissions.create({
              fileId: file.data.id,
              requestBody: {
                role: 'reader',
                type: 'anyone',
              },
            });
          } catch (permissionError) {
            const failureReason = 'Your request to make file public on Google Drive failed. ERROR: ' + permissionError;

            // Check sf create log is true or false
            if (sfCreateLog) {
              // Create File Migration Logs
              const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
            }
            return;
          }
        }
        resolve(file);
      }
    );
  });
}

// This service is used to upload salesforce files and attachments into Google Drive from local host
app.get('/', async (req, res) => {
  try {
    // Replace these values with your own Salesforce Connected App credentials
    const sfFileId = '{SALESFORCE_CONTENT_VERSION_ID}'; 
    const googleDriveClientId = '{GOOGLE_DRIVE_CLIENT_ID}';
    const googleDriveClientSecretId = '{GOOGLE_DRIVE_CLIENT_SECRET_ID}';
    const sfClientId = '{SALESFORCE_CLIENT_ID}';
    const sfClientSecret = '{SALESFORCE_CLIENT_SECRET_KEY}';
    const sfUsername = '{SALESFORCE_USERNAME}';
    const sfPassword = '{SALESFORCE_PASSWORD}';
    const googleDriveBucketName = '{GOOGLE_DRIVE_BUCKET_NAME}';
    const sfFileSize = '{SALESFORCE_FILE_SIZE}';
    const sfContentDocumentId = '{SALESFORCE_CONTENT_DOCUMENT_ID}';
    const googleDriveFolderKey = '{GOOGLE_DRIVE_FOLDER_KEY}'
    const googleDriveFileTitle = 'GOOGLE_DRIVE_FILE_TITLE';
    const sfParentId = '{SALESFORCE_PARENT_ID}';
    const sfContentDocumentLinkId = '{SALESFORCE_CONTENT_DOCUMENT_LINK_ID}';
    const sfNamespace = '{SALESFORCE_NAMESPACE}';
    const sfDeleteFile = '{SALESFORCE_DELETE_FILE}';
    const sfCreateLog = '{SALESFORCE_CREATE_LOG}';
    const gFile = '{G_FILE}';
    const googleDriveFileMetadata = '{GOOGLE_DRIVE_FILE_METADATA}';
    const googleDriveRefreshToken = '{GOOGLE_DRIVE_REFRESH_TOKEN}';
    const googleDriveFolderId = '{GOOGLE_DRIVE_FOLDER_ID}';

    // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
    res.send(`Heroku service to migrate Salesforce File has been started successfully.`);
    
    const reponse = await migrateSalesforce (sfFileId, googleDriveClientId, googleDriveClientSecretId, googleDriveRefreshToken, sfClientId, sfClientSecret, sfUsername, sfPassword, googleDriveBucketName, googleDriveFolderKey, googleDriveFileTitle, sfFileSize, sfContentDocumentId, sfParentId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, gFile, googleDriveFileMetadata, googleDriveFolderId);
  } catch (error) {
    console.error(error);
  }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

