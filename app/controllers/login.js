'use strict';

var module = angular.module('experience.controllers.login', []);

var LoginController = function ($scope, $state, $ionicHistory, $ionicPopup, userService, storeService) {

  $scope.user = storeService.getUser();

  $scope.login = function () {
    userService.loginJumping().then(function () {
        $ionicHistory.nextViewOptions({
          historyRoot: true,
        });
        $state.go('scanning');
      }).then(function () {
        userService.loadDetails();
      }).catch(function (error) {
        $ionicPopup.alert({
          title: 'Jumping login failed.',
          template: 'Please try again.',
          okType: 'button-assertive',
        });
      });
  };
};

module.controller('LoginController', LoginController);
