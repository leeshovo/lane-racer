// Attrappe für js/cars.js: gleiche Schnittstelle, aber ohne Geometrie.
import * as THREE from 'three';

function vehicle(w = 1.9, h = 1.5, l = 4.2) {
  const object = new THREE.Group();
  const body = new THREE.Group();
  object.add(body);
  return {
    object, body, size: new THREE.Vector3(w, h, l),
    setNitro() {}, setBrake() {}, setHeadlights() {}, update() {}, dispose() {},
  };
}
export const createPlayerCar = () => vehicle();
export const createTrafficVehicle = () => vehicle();
export const createGhostCar = () => vehicle();
export const createNameTag = () => new THREE.Sprite();
