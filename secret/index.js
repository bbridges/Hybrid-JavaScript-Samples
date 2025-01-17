// uncomment to ignore 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' error
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; 

const Environment = require("@azure/ms-rest-azure-env");
const msRestNodeAuth = require("@azure/ms-rest-nodeauth");
const KeyVaultManagementClient = require("@azure/arm-keyvault-profile-2020-09-01-hybrid").KeyVaultManagementClient;
const ResourceManagementClient = require("@azure/arm-resources-profile-2020-09-01-hybrid").ResourceManagementClient;
const util = require("util");
const axios = require("axios");
const config = require("../azureSecretSpConfig.json");

const clientIdProp = "clientId";
const clientSecretProp = "clientSecret";
const objectIdProp = "objectId";
const subscriptionIdProp = "subscriptionId";
const armEndpointProp = "resourceManagerEndpointUrl";
const tenantIdProp = "tenantId";
const locationProp = "location";

_validateConfigVariables();

var clientId = config[clientIdProp];
var clientSecret = config[clientSecretProp];
var objectId = config[objectIdProp];
var subscriptionId = config[subscriptionIdProp];
var armEndpoint = config[armEndpointProp];
var tenantId = config[tenantIdProp];
var location = config[locationProp];
var tenantIdForLogin = tenantId;
var resourceGroupName = "azure-sample-javascript-secret";
var keyVaultName = "azure-sample-kv";
var secretName = "azure-app-created-secret";
var secretValue = "azure-app-created-password";

if (armEndpoint.slice(-1) != "/") {
    armEndpoint = armEndpoint + "/";
}
const fetchUrl = armEndpoint + "metadata/endpoints?api-version=2019-10-01";

function _validateConfigVariables() {
    var missingConfig = [];
    if (!config[clientIdProp]) missingConfig.push(clientIdProp);
    if (!config[clientSecretProp]) missingConfig.push(clientSecretProp);
    if (!config[objectIdProp]) missingConfig.push(objectIdProp);
    if (!config[armEndpointProp]) missingConfig.push(armEndpointProp);
    if (!config[locationProp]) missingConfig.push(locationProp);
    if (!config[subscriptionIdProp]) missingConfig.push(subscriptionIdProp);
    if (!config[tenantIdProp]) missingConfig.push(tenantIdProp);
    if (missingConfig.length > 0) {
        throw new Error(util.format("Please set the following configurations: %s", missingConfig.toString()));
    }
}

async function fetchEndpointMetadata() {
    try {
        const response = await axios.get(fetchUrl);
        return response.data;
    } catch (error) {
        console.error(error);
    }
}

function setEnvironment(metadata) {
    metadata = metadata[0];
    console.log(metadata);
    console.log("Setting environment");
    map = {};
    map["name"] = "AzureStack";
    map["portalUrl"] = metadata.portal;
    map["resourceManagerEndpointUrl"] = armEndpoint;
    map["galleryEndpointUrl"] = metadata.gallery;
    map["activeDirectoryEndpointUrl"] = metadata.authentication.loginEndpoint.slice(0, metadata.authentication.loginEndpoint.lastIndexOf("/") + 1);
    map["activeDirectoryResourceId"] = metadata.authentication.audiences[0];
    map["activeDirectoryGraphResourceId"] = metadata.graph;
    map["storageEndpointSuffix"] = metadata.suffixes.storage;
    map["keyVaultDnsSuffix"] = metadata.suffixes.keyVaultDns;
    map["managementEndpointUrl"] = metadata.authentication.audiences[0];
    Environment.Environment.add(map);

    var options = {};
    options["environment"] = Environment.Environment.AzureStack;
    options["tokenAudience"] = map["activeDirectoryResourceId"];
    var isAdfs = metadata.authentication.loginEndpoint.endsWith("adfs") || metadata.authentication.loginEndpoint.endsWith("adfs/");
    if (isAdfs) {
        tenantIdForLogin = "adfs";
        options.environment.validateAuthority = false;
        map["validateAuthority"] = false;
    }

    return new Promise((resolve, reject) => {
        resolve(options);
    });
}

function loginWithSP(envOptions) {
    return msRestNodeAuth.loginWithServicePrincipalSecret(clientId, clientSecret, tenantIdForLogin, envOptions);
}

function createResourceGroup(credentials) {
    var resourceClient = new ResourceManagementClient(credentials, subscriptionId);
    var parameters = { "location": location };
    console.log("Creating resource group: " + resourceGroupName);
    return resourceClient.resourceGroups.createOrUpdate(resourceGroupName, parameters);
}

function createKeyVault(credentials) {
    var keyVaultClient = new KeyVaultManagementClient(credentials, subscriptionId);
    var parameters = {
        "location": location,
        "properties": {
            "sku": { "name": "standard" },
            "accessPolicies": [
                {
                    "tenantId": tenantId,
                    "objectId": objectId,
                    "permissions": { "secrets": ["all"] }
                }
            ],
            "enabledForDeployment": false,
            "tenantId": tenantId
        },
        tags: {}
    }; 
    console.log("Creating keyvault: " + keyVaultName);  
    // Create the sample key vault using the KV management client.
    return keyVaultClient.vaults.createOrUpdate(resourceGroupName, keyVaultName, parameters);
}

function updateSecret(credentials) {
    var keyVaultClient = new KeyVaultManagementClient(credentials, subscriptionId);
    var parameters = {
        "properties": {
            "attributes": {},
            "contentType": "",
            "secretUri": "",
            "secretUriWithVersion": "",
            "value": secretValue
        },
        "tags": {}
    };
    console.log("Updating secret: " + secretName);
    keyVaultClient.secrets.createOrUpdate(resourceGroupName, keyVaultName, secretName, parameters, function (err, result) {
        if (err) {
            console.log("Error while writing secret");
            console.log(err);
        } else {
            console.log("Secret set successfully");
            console.log(result);
        }
        console.log(util.format("Please execute the following script for cleanup:\nnode cleanup.js"));
    });
}

fetchEndpointMetadata()
.then(setEnvironment)
.then(loginWithSP)
.then((credentials) => {
    createResourceGroup(credentials)
    .then((result) => {
        console.log(result);
        return createKeyVault(credentials);
    })
    .then((result) => {
        console.log(result);
        updateSecret(credentials);
    });
});
