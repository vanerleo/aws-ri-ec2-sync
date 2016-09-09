'use strict';
var Promise = require('bluebird');
var vandium = require('vandium');
var AWS = require('aws-sdk');
var util = require('util');


module.exports.handler = vandium(main);

// var credentials = new AWS.SharedIniFileCredentials({ profile: '---PROFILE NAME---' });
// AWS.config.credentials = credentials;
// AWS.config.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
// main();

function main(event) {

  console.log('Looking in Region :' + AWS.config.region);
  var ec2 = new AWS.EC2();

  var ec2Params = {
    Filters: [
      {
        Name: 'instance-state-name',
        Values: [
          'running',
        ]
      }
    ]
  };

  var riParams = {
    Filters: [
      {
        Name: 'state',
        Values: [
          'active',
        ]
      }
    ]
  };
  var riPromise = ec2.describeReservedInstances(riParams).promise();
  var ec2Promise = ec2.describeInstances(ec2Params).promise();

  var reservedInstances = [];
  var ec2Instances = [];

  return riPromise.then(function (riData) {
    //console.log(riData);
    if (!riData.ReservedInstances || riData.ReservedInstances.length === 0) {
      // should buy some
      return;
    }

    riData.ReservedInstances.map(function (ri) {
      // console.log(ri);

      var reservedInstance = {
        id: ri.ReservedInstancesId,
        zone: ri.AvailabilityZone,
        type: ri.InstanceType,
        os: ri.ProductDescription,
        name: 'RI',
        VPC: (ri.ProductDescription.toLowerCase().indexOf('vpc')) ? 'EC2-VPC' : 'EC2-Classic'
      };
      reservedInstances.push(reservedInstance);
    });


    return ec2Promise.then(function (ec2Data) {
      // console.log(ec2Data);

      if (!ec2Data || ec2Data.Reservations.length === 0) {
        return;
      }
      return Promise.all(ec2Data.Reservations.map(function (ec2Status) {

        //console.log(util.inspect(ec2Status, { showHidden: false, depth: null }));

        return Promise.all(ec2Status.Instances.map(function (ec2InstanceData) {
          var ec2Name;
          ec2InstanceData.Tags.map(function (tag) {
            if (tag.Key === 'Name') {
              ec2Name = tag.Value;
            }
          });
          var ec2Instance = {
            zone: ec2InstanceData.Placement.AvailabilityZone,
            type: ec2InstanceData.InstanceType,
            os: ec2InstanceData.Platform ? ec2InstanceData.Platform : 'linux',
            name: ec2Name
          };
          ec2Instances.push(ec2Instance);
        }));

      }));

    });

  }).then(function () {
    // console.log(reservedInstances);
    // console.log(ec2Instances);
    var allInUse = true;
    ec2Instances.map(function (ec2) {
      reservedInstances.map(function (ri) {
        if (!ri.EC2 && !ec2.RI &&
          ri.zone === ec2.zone &&
          ri.type === ec2.type &&
          ri.os.toLowerCase().indexOf(ec2.os.toLowerCase()) !== -1) {
          ri.EC2 = ec2;
          ec2.RI = ri;
        }
      });
    });
    var ec2WithNoRIs = ec2Instances.filter(function (ec2) {
      return !ec2.RI;
    });
    var riWithNoEC2s = reservedInstances.filter(function (ri) {
      return !ri.EC2;
    });

    // console.log(ec2WithNoRIs);
    // console.log(riWithNoEC2s);

    return Promise.all(ec2WithNoRIs.map(function (ec2WithNoRI) {
      var matchedRIs = riWithNoEC2s.filter(function (riWithNoEC2) {
        return (riWithNoEC2.type === ec2WithNoRI.type && riWithNoEC2.os.toLowerCase().indexOf(ec2WithNoRI.os.toLowerCase()) !== -1);
      });
      if (!matchedRIs || matchedRIs.length === 0) {
        console.log('NO RI found for ' + ec2WithNoRI.name);
        return;
      }
      var firstRI = matchedRIs[0];
      console.log('Updating RI "' + firstRI.id + '" configuration to match "' + ec2WithNoRI.name + '"');
      var riModifyParams = {
        ReservedInstancesIds: [firstRI.id],
        TargetConfigurations: [ /* required */
          {
            AvailabilityZone: ec2WithNoRI.zone,
            InstanceCount: 1,
            Platform: firstRI.VPC
            //InstanceType: firstRI.type
          }
        ]
      };
      console.log(riModifyParams);
      return ec2.modifyReservedInstances(riModifyParams).promise();

    }));

  }).catch(function (err) {
    console.log(err);
  });
}