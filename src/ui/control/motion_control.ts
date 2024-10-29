import { LngLat } from '../../geo/lng_lat';
import { browser } from '../../util/browser';
import { earthRadius } from '../../geo/lng_lat';
import type { Map } from '../map';
import type { IControl } from './control';

interface MotionState {
    position: {
        lat: number;
        lng: number;
        altitude: number;
    };
    attitude: {
        heading: number;
        pitch: number;
        roll: number;
    };
    velocity: {
        groundSpeed: number;
        verticalSpeed: number;
        groundTrack: number;
    };
    lastUpdateTime: number;
}

interface CameraMode {
    type: 'COCKPIT' | 'CHASE' | 'ORBIT' | 'FREE';
    offset?: {
        x: number;
        y: number;
        z: number;
    };
    orientation?: {
        heading: number;
        pitch: number;
        roll: number;
    };
}

export class AircraftMotionControl implements IControl {
    _map: Map;
    _container: HTMLElement;
    _currentState: MotionState | null = null;
    _previousState: MotionState | null = null;
    _smoothingFactor: number = 0.15;
    _frameId: number | null = null;

    // Camera configuration
    _cameraMode: CameraMode = {
        type: 'COCKPIT',
        offset: { x: 0, y: -30, z: 10 },
        orientation: { heading: 0, pitch: 0, roll: 0 }
    };

    // Interpolation state
    _velocitySmoothed = { x: 0, y: 0, z: 0 };
    _angularVelocitySmoothed = { heading: 0, pitch: 0, roll: 0 };

    constructor(options: {
        initialPosition?: {
            lat: number;
            lng: number;
            altitude: number;
        };
        cameraMode?: CameraMode;
    } = {}) {
        if (options.initialPosition) {
            this._currentState = {
                position: {
                    lat: options.initialPosition.lat,
                    lng: options.initialPosition.lng,
                    altitude: options.initialPosition.altitude
                },
                attitude: {
                    heading: 0,
                    pitch: 0,
                    roll: 0
                },
                velocity: {
                    groundSpeed: 0,
                    verticalSpeed: 0,
                    groundTrack: 0
                },
                lastUpdateTime: browser.now()
            };
        }

        if (options.cameraMode) {
            this._cameraMode = {
                ...options.cameraMode,
                offset: options.cameraMode.offset || { x: 0, y: 0, z: 0 },
                orientation: options.cameraMode.orientation || { heading: 0, pitch: 0, roll: 0 }
            };
        }
    }

    onAdd(map: Map): HTMLElement {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl';

        this._map.dragRotate.disable();
        this._map.touchZoomRotate.disableRotation();
        this._map.keyboard.disable();

        // Start the update loop
        this._startUpdate();

        return this._container;
    }

    onRemove(): void {
        this._stopUpdate();
        this._container.parentNode?.removeChild(this._container);

        this._map.dragRotate.enable();
        this._map.touchZoomRotate.enableRotation();
        this._map.keyboard.enable();
        this._map = undefined;
    }

    _startUpdate(): void {
        const updateFrame = () => {
            this._updateCameraFromState();
            this._frameId = requestAnimationFrame(updateFrame);
        };
        this._frameId = requestAnimationFrame(updateFrame);
    }

    _stopUpdate(): void {
        if (this._frameId) {
            cancelAnimationFrame(this._frameId);
            this._frameId = null;
        }
    }

    updateAircraftState(state: {
        lat: number;
        lng: number;
        elevation: number;
        groundTrack: number;
        aircraftHeading: number;
        groundSpeed: number;
        verticalSpeed: number;
        pitchAttitude: number;
        rollAttitude: number;
    }) {
        const now = browser.now();
        const deltaTime = this._currentState ?
            (now - this._currentState.lastUpdateTime) / 1000 : 0;

        // Store previous state
        this._previousState = this._currentState;

        // Update current state
        this._currentState = {
            position: {
                lat: state.lat,
                lng: state.lng,
                altitude: state.elevation
            },
            attitude: {
                heading: state.aircraftHeading,
                pitch: state.pitchAttitude,
                roll: state.rollAttitude
            },
            velocity: {
                groundSpeed: state.groundSpeed,
                verticalSpeed: state.verticalSpeed,
                groundTrack: state.groundTrack
            },
            lastUpdateTime: now
        };

        // Calculate motion derivatives if we have previous state
        if (this._previousState && deltaTime > 0) {
            this._updateMotionDerivatives(deltaTime);
        }
    }

    _updateCameraFromState(): void {
        if (!this._currentState || !this._map) return;

        const now = browser.now();
        const deltaTime = (now - this._currentState.lastUpdateTime) / 1000;

        // Predict current position based on last known velocity
        const predictedState = this._predictCurrentState(deltaTime);

        const cameraPosition = this._calculateCameraPosition(predictedState);
        if (!cameraPosition) return;

        const { camPos, camAlt, heading, pitch, roll } = cameraPosition;

        // Update the map camera
        const jumpToOptions = this._map.calculateCameraOptionsFromCameraLngLatAltRotation(camPos, camAlt, heading, pitch, roll);
        this._map.jumpTo(jumpToOptions);
    }

    _predictCurrentState(deltaTime: number): MotionState {
        const state = this._currentState;

        const metersPerDegree = 111111;

        // Use smoothed velocities to predict new position
        // Calculate position changes
        const latChange = Number(((this._velocitySmoothed.y * deltaTime) / metersPerDegree).toFixed(6));
        const lngChange = Number(((this._velocitySmoothed.x * deltaTime) /
            (metersPerDegree * Math.cos(Number((state.position.lat * Math.PI / 180).toFixed(6))))
        ).toFixed(6));
        const altChange = Number((this._velocitySmoothed.z * deltaTime).toFixed(6));

        // Calculate attitude changes
        const headingChange = Number((this._angularVelocitySmoothed.heading * deltaTime).toFixed(6));
        const pitchChange = Number((this._angularVelocitySmoothed.pitch * deltaTime).toFixed(6));
        const rollChange = Number((this._angularVelocitySmoothed.roll * deltaTime).toFixed(6));
        console.log(headingChange, pitchChange, rollChange);

        // Create predicted state
        const predictedState: MotionState = {
            position: {
                lat: Number((state.position.lat + latChange).toFixed(6)),
                lng: Number((state.position.lng + lngChange).toFixed(6)),
                altitude: Number((state.position.altitude + altChange).toFixed(6))
            },
            attitude: {
                heading: Number(((state.attitude.heading + headingChange + 360) % 360).toFixed(6)),
                pitch: Number((state.attitude.pitch + pitchChange).toFixed(6)),
                roll: Number((state.attitude.roll + rollChange).toFixed(6))
            },
            velocity: {
                groundSpeed: Number(state.velocity.groundSpeed.toFixed(6)),
                verticalSpeed: Number(state.velocity.verticalSpeed.toFixed(6)),
                groundTrack: Number(state.velocity.groundTrack.toFixed(6))
            },
            lastUpdateTime: state.lastUpdateTime
        };

        return predictedState;
    }

    /**
     * Calculate relative camera position based on current mode and aircraft state
     */
    _calculateCameraPosition(state: MotionState = this._currentState): { camPos: LngLat; camAlt: number; heading: number; pitch: number; roll: number } | null {
        if (!this._currentState) return null;

        const mode = this._cameraMode;
        let camPos: LngLat;
        let camAlt: number;
        let heading: number;
        let pitch: number;
        let roll: number;

        switch (mode.type) {
            case 'COCKPIT':
                // Position camera at aircraft position with slight offset for pilot view
                camPos = new LngLat(state.position.lng, state.position.lat);
                camAlt = state.position.altitude + mode.offset.z;
                heading = state.attitude.heading;
                pitch = state.attitude.pitch;
                roll = state.attitude.roll;
                break;

            case 'CHASE':
                // Calculate chase camera position behind aircraft
                const offsetMeters = this._calculateChaseOffset(mode.offset);
                camPos = this._offsetPosition(
                    state.position.lat,
                    state.position.lng,
                    state.attitude.heading,
                    offsetMeters.x,
                    offsetMeters.y
                );
                camAlt = state.position.altitude + offsetMeters.z;
                heading = state.attitude.heading;
                pitch = state.attitude.pitch * 0.5;
                roll = state.attitude.roll * 0.5;
                break;

            case 'ORBIT':
                // Calculate orbiting camera position
                const orbitAngle = (browser.now() % 30000) / 30000 * Math.PI * 2;
                const radius = Math.sqrt(mode.offset.y * mode.offset.y + mode.offset.x * mode.offset.x);
                const orbitX = Math.cos(orbitAngle) * radius;
                const orbitY = Math.sin(orbitAngle) * radius;
                camPos = this._offsetPosition(
                    state.position.lat,
                    state.position.lng,
                    0,
                    orbitX,
                    orbitY
                );
                camAlt = state.position.altitude + mode.offset.z;
                heading = this._calculateHeadingToPoint(
                    camPos.lat,
                    camPos.lng,
                    state.position.lat,
                    state.position.lng
                );
                pitch = this._calculatePitchToPoint(
                    camPos.lat,
                    camPos.lng,
                    camAlt,
                    state.position.lat,
                    state.position.lng,
                    state.position.altitude
                );
                roll = 0;
                break;

            case 'FREE':
                camPos = new LngLat(state.position.lng, state.position.lat);
                camAlt = state.position.altitude;
                heading = mode.orientation.heading;
                pitch = mode.orientation.pitch;
                roll = mode.orientation.roll;
                break;
        }

        return { camPos, camAlt, heading, pitch, roll };
    }

    /**
     * Calculate offset position based on bearing and distance
     */
    _offsetPosition(lat: number, lng: number, bearing: number, offsetX: number, offsetY: number): LngLat {

        // Convert to radians and adjust for coord system
        const bearingRad = (bearing - 90) * Math.PI / 180;
        const R = earthRadius;

        const offsetBearing = Math.atan2(offsetY, offsetX);
        const offsetDistance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

        const lat1 = lat * Math.PI / 180;
        const lng1 = lng * Math.PI / 180;
        const bearing1 = bearingRad + offsetBearing;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(offsetDistance / R) +
            Math.cos(lat1) * Math.sin(offsetDistance / R) * Math.cos(bearing1)
        );

        const lng2 = lng1 + Math.atan2(
            Math.sin(bearing1) * Math.sin(offsetDistance / R) * Math.cos(lat1),
            Math.cos(offsetDistance / R) - Math.sin(lat1) * Math.sin(lat2)
        );

        return new LngLat(
            lng2 * 180 / Math.PI,
            lat2 * 180 / Math.PI
        );
    }

    _updateMotionDerivatives(deltaTime: number) {
        if (!this._previousState || !this._currentState) return;

        const prev = this._previousState;
        const curr = this._currentState;

        const metersPerDegree = 111111;

        // Calculate position differences
        const cosLat = Number((Math.cos(curr.position.lat * Math.PI / 180)).toFixed(6));
        const dx = Number(((curr.position.lng - prev.position.lng) * cosLat * metersPerDegree).toFixed(6));
        const dy = Number(((curr.position.lat - prev.position.lat) * metersPerDegree).toFixed(6));
        const dz = Number((curr.position.altitude - prev.position.altitude).toFixed(6));

        // Calculate instantaneous velocities
        const vx = Number((dx / deltaTime).toFixed(6));
        const vy = Number((dy / deltaTime).toFixed(6));
        const vz = Number((dz / deltaTime).toFixed(6));

        // Calculate angular differences
        const dHeading = Number((this._shortestAngleDifference(prev.attitude.heading, curr.attitude.heading)).toFixed(6));
        const dPitch = Number((curr.attitude.pitch - prev.attitude.pitch).toFixed(6));
        const dRoll = Number((curr.attitude.roll - prev.attitude.roll).toFixed(6));

        // Calculate angular velocities
        const angularVelocityHeading = Number((dHeading / deltaTime).toFixed(6));
        const angularVelocityPitch = Number((dPitch / deltaTime).toFixed(6));
        const angularVelocityRoll = Number((dRoll / deltaTime).toFixed(6));

        // Apply smoothing
        // You can increase the smoothing factor to add more precision
        const predictionSmoothingFactor = 0.3;

        // Smooth linear velocities
        this._velocitySmoothed.x = Number((this._velocitySmoothed.x +
            (vx - this._velocitySmoothed.x) * predictionSmoothingFactor).toFixed(6));
        this._velocitySmoothed.y = Number((this._velocitySmoothed.y +
            (vy - this._velocitySmoothed.y) * predictionSmoothingFactor).toFixed(6));
        this._velocitySmoothed.z = Number((this._velocitySmoothed.z +
            (vz - this._velocitySmoothed.z) * predictionSmoothingFactor).toFixed(6));

        // Smooth angular velocities
        this._angularVelocitySmoothed.heading = Number((this._angularVelocitySmoothed.heading +
            (angularVelocityHeading - this._angularVelocitySmoothed.heading) * predictionSmoothingFactor).toFixed(6));
        this._angularVelocitySmoothed.pitch = Number((this._angularVelocitySmoothed.pitch +
            (angularVelocityPitch - this._angularVelocitySmoothed.pitch) * predictionSmoothingFactor).toFixed(6));
        this._angularVelocitySmoothed.roll = Number((this._angularVelocitySmoothed.roll +
            (angularVelocityRoll - this._angularVelocitySmoothed.roll) * predictionSmoothingFactor).toFixed(6));
    }

    /**
     * Calculate chase camera offset based on aircraft velocity
     */
    _calculateChaseOffset(baseOffset: { x: number; y: number; z: number }) {
        if (!this._currentState) return baseOffset;

        const speed = this._currentState.velocity.groundSpeed;
        const speedFactor = Math.min(speed / 100, 1); // Normalize speed effect

        return {
            x: baseOffset.x,
            y: baseOffset.y * (1 + speedFactor * 0.5), // Increase distance with speed
            z: baseOffset.z * (1 + speedFactor * 0.3)  // Increase height with speed
        };
    }

    /**
     * Calculate heading to look at a point
     */
    _calculateHeadingToPoint(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
        const dLng = (toLng - fromLng) * Math.PI / 180;
        const fromLatRad = fromLat * Math.PI / 180;
        const toLatRad = toLat * Math.PI / 180;

        const y = Math.sin(dLng) * Math.cos(toLatRad);
        const x = Math.cos(fromLatRad) * Math.sin(toLatRad) -
            Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLng);

        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    /**
     * Calculate pitch to look at a point
     */
    _calculatePitchToPoint(fromLat: number, fromLng: number, fromAlt: number,
        toLat: number, toLng: number, toAlt: number): number {
        const R = earthRadius; // Earth's radius in meters
        const dLat = (toLat - fromLat) * Math.PI / 180;
        const dLng = (toLng - fromLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        const dAlt = toAlt - fromAlt;

        return -Math.atan2(dAlt, distance) * 180 / Math.PI;
    }

    /**
     * Calculate shortest angle difference
     */
    _shortestAngleDifference(angle1: number, angle2: number): number {
        let diff = Number((angle2 - angle1).toFixed(6));
        while (diff > 180) diff = Number((diff - 360).toFixed(6));
        while (diff < -180) diff = Number((diff + 360).toFixed(6));
        return diff;
    }

    /**
     * Sets the camera mode
     */
    setCameraMode(mode: CameraMode): void {
        this._cameraMode = {
            ...mode,
            offset: mode.offset || { x: 0, y: 0, z: 0 },
            orientation: mode.orientation || { heading: 0, pitch: 0, roll: 0 }
        };

        if (mode.type === 'CHASE' && !mode.offset) {
            this._cameraMode.offset = { x: 0, y: -30, z: 10 };
        } else if (mode.type === 'ORBIT' && !mode.offset) {
            this._cameraMode.offset = { x: 0, y: -100, z: 50 };
        }

        if (this._currentState) {
            this._updateCameraFromState();
        }
    }

    getState(): MotionState | null {
        return this._currentState ? { ...this._currentState } : null;
    }
}
