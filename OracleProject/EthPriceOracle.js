const axios = require('axios')
const BN = require('bn.js')
const common = require('./utils/common.js')
const SLEEP_INTERVAL = process.env.SLEEP_INTERVAL || 2000
const PRIVATE_KEY_FILE_NAME = process.env.PRIVATE_KEY_FILE || './oracle/oracle_private_key'
const CHUNK_SIZE = process.env.CHUNK_SIZE || 3
const MAX_RETRIES = process.env.MAX_RETRIES || 5
//Build artifacts from the smart contract - inside the JSON file
const OracleJSON = require('./oracle/build/contracts/EthPriceOracle.json')
var pendingRequests = []

async function getOracleContract (web3js) {
  //resolves the network id by calling the web3js.eth.net.getId()
  const networkId = await web3js.eth.net.getId()
  //instantiates the deployed contract using web3.eth.Contract so the JS can interact with it
  return new web3js.eth.Contract(OracleJSON.abi, OracleJSON.networks[networkId].address)
}

async function retrieveLatestEthPrice () {
  const resp = await axios({
    url: 'https://api.binance.com/api/v3/ticker/price',
    params: {
      symbol: 'ETHUSDT'
    },
    method: 'get'
  })
  return resp.data.price
}

//function "watches" for events everytime the oracle triggers an action
async function filterEvents (oracleContract, web3js) {
  oracleContract.events.GetLatestEthPriceEvent(async (err, event) => {
    if (err) {
      console.error('Error on event', err)
      return
    }
    await addRequestToQueue(event)
  })

  oracleContract.events.SetLatestEthPriceEvent(async (err, event) => {
    if (err) console.error('Error on event', err)
    // Do something
  })
}

//The below function access the return values of the event and adds them to the pendingRequests array - where it is called above this is for the GetLatestEthPriceEvent
async function addRequestToQueue (event) {
  const callerAddress = event.returnValues.callerAddress
  const id = event.returnValues.id
  pendingRequests.push({ callerAddress, id })

}

//The below function loops through the pendingRequests but break up the array into smaller chunks
async function processQueue (oracleContract, ownerAddress) {
  let processedRequests = 0
  while (pendingRequests.length > 0 && processedRequests < CHUNK_SIZE) {
    //.shift removes the first element from the array and recalulates the length
    const req = pendingRequests.shift()
    //dot notation of req object retrieves the properties
    await processRequest(oracleContract, ownerAddress, req.id, req.callerAddress)
    processedRequests++
  }
}

async function processRequest (oracleContract, ownerAddress, id, callerAddress) {
  let retries = 0
  while (retries < MAX_RETRIES) {
    try {
      //This function talks with the Binance public API
      const ethPrice = await retrieveLatestEthPrice()
      await setLatestEthPrice(oracleContract, callerAddress, ownerAddress, ethPrice, id)
      return
    } catch (error) {
      if (retries === MAX_RETRIES - 1) {
        await setLatestEthPrice(oracleContract, callerAddress, ownerAddress, '0', id)
        return
     } 
     retries++
    }
  }
}

async function setLatestEthPrice (oracleContract, callerAddress, ownerAddress, ethPrice, id) {
  //Removes the decimal separator (the dot)
  ethPrice = ethPrice.replace('.', '')
  //Note: the sceond argument represents the base.
  const multiplier = new BN(10**10, 10)
  const ethPriceInt = (new BN(parseInt(ethPrice), 10)).mul(multiplier)
  const idInt = new BN(parseInt(id))
  try {
    await oracleContract.methods.setLatestEthPrice(ethPriceInt.toString(), callerAddress, idInt.toString()).send({ from: ownerAddress })
  } catch (error) {
    console.log('Error encountered while calling setLatestEthPrice.')
    
  }
}

// JS functions can't return mutiple values so you can use an object or array to overcome this.
//This function returns a bunch of values requires by other functions
async function init () {
  //This unpacks the multiple values returned by the function
  const {ownerAddress, web3js, client} = common.loadAccount(PRIVATE_KEY_FILE_NAME)
  //Instantiates the oracle contract by calling the below function - returns a promise
  const oracleContract = await getOracleContract(web3js)
  filterEvents(oracleContract, web3js)
  return {oracleContract, ownerAddress, client}
}

(async () => {
  const { oracleContract, ownerAddress, client } = await init()
  process.on( 'SIGINT', () => {
    console.log('Calling client.disconnect()')
    client.disconnect()
    process.exit( )
  })
  //this will repeatedly 'do something' with a predetermined delay between each iteration
  setInterval(async () => {
    await processQueue(oracleContract, ownerAddress)
  }, SLEEP_INTERVAL)
})()