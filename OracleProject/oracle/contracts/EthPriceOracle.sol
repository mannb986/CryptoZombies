pragma solidity 0.5.0;
// 1. On the next line, import from the `openzeppelin-solidity/contracts/access/Roles.sol` file
import "openzeppelin-solidity/contracts/access/Roles.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./CallerContractInterface.sol";
contract EthPriceOracle {
  //Roles is a library. We can attach it to the Roles.Role data type as per below. 
  //This means the first parameter in the functions from the library is automically passed.
  using Roles for Roles.Role;
  using SafeMath for uint256; // Tell your contract to use `SafeMath` for `uint256`
  Roles.Role private owners;
  Roles.Role private oracles;
  uint private randNonce = 0;
  uint private modulus = 1000;
  uint private numOracles = 0;
  uint private THRESHOLD = 0;
  mapping(uint256=>bool) pendingRequests;
  struct Response {
  address oracleAddress;
  address callerAddress;
  uint256 ethPrice;
  }
  event GetLatestEthPriceEvent(address callerAddress, uint id);
  event SetLatestEthPriceEvent(uint256 ethPrice, address callerAddress);
  event AddOracleEvent(address oracleAddress);
  event RemoveOracleEvent(address oracleAddress);

  //constructor sets the owners address
  constructor (address _owner) public {
    owners.add(_owner);
  }

  // Function to enable oracles to be added
  function addOracle (address _oracle) public {
    require(owners.has(msg.sender), "Not an owner!");
    require(!oracles.has(_oracle), "Already an oracle!");
    oracles.add(_oracle);
    emit AddOracleEvent(_oracle);
  }

  // Function to remove oracles
  function removeOracle (address _oracle) public {
  require(owners.has(msg.sender), "Not an owner!");
  require(oracles.has(_oracle), "Not an oracle!");
  require (numOracles > 1, "Do not remove the last oracle!");
  oracles.remove(_oracle);
  numOracles--;
  emit RemoveOracleEvent(_oracle);
  }

  function setThreshold (uint _threshold) public {
  require(owners.has(msg.sender), "Not an owner!");
  THRESHOLD = _threshold;
  emit SetThresholdEvent(THRESHOLD);
  }

  function getLatestEthPrice() public returns (uint256) {
    randNonce++;
    uint id = uint(keccak256(abi.encodePacked(now, msg.sender, randNonce))) % modulus;
    pendingRequests[id] = true;
    emit GetLatestEthPriceEvent(msg.sender, id);
    return id;
  }
  function setLatestEthPrice(uint256 _ethPrice, address _callerAddress, uint256 _id) public {
    require(oracles.has(msg.sender), "Not an oracle!");
    require(pendingRequests[_id], "This request is not in my pending list.");
    Response memory resp; //declare the struct
    resp = Response(msg.sender, _callerAddress, _ethPrice); //initialize it
    requestIdToResponse[_id].push(resp);
    uint numResponses = requestIdToResponse[_id].length;
    if (numResponses == THRESHOLD) {
      uint computedEthPrice = 0;
        for (uint f=0; f < requestIdToResponse[_id].length; f++) {
        computedEthPrice = computedEthPrice.add(requestIdToResponse[_id][f].ethPrice); // Replace this with a `SafeMatch` method
      }
      computedEthPrice = computedEthPrice.div(numResponses);
      delete pendingRequests[_id];
      delete requestIdToResponse[_id];
      CallerContracInterface callerContractInstance;
      callerContractInstance = CallerContracInterface(_callerAddress);
      callerContractInstance.callback(computedEthPrice, _id); 
      emit SetLatestEthPriceEvent(computedEthPrice, _callerAddress); 
    }
  }
}