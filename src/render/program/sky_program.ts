import {UniformColor, Uniform1f, Uniform2f} from '../uniform_binding';
import type {Context} from '../../gl/context';
import type {UniformValues, UniformLocations} from '../uniform_binding';
import {IReadonlyTransform} from '../../geo/transform_interface';
import {Sky} from '../../style/sky';
import {getMercatorHorizon} from '../../geo/projection/mercator_utils';

export type SkyUniformsType = {
    'u_sky_color': UniformColor;
    'u_horizon_color': UniformColor;
    'u_horizon': Uniform2f;
    'u_horizon_normal': Uniform2f;
    'u_sky_horizon_blend': Uniform1f;
};

const skyUniforms = (context: Context, locations: UniformLocations): SkyUniformsType => ({
    'u_sky_color': new UniformColor(context, locations.u_sky_color),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon': new Uniform2f(context, locations.u_horizon),
    'u_horizon_normal': new Uniform2f(context, locations.u_horizon_normal),
    'u_sky_horizon_blend': new Uniform1f(context, locations.u_sky_horizon_blend),
});

const skyUniformValues = (sky: Sky, transform: IReadonlyTransform, pixelRatio: number): UniformValues<SkyUniformsType> => {
    const cos_roll = Math.cos(transform.roll * Math.PI / 180.0);
    const sin_roll = Math.sin(transform.roll * Math.PI / 180.0);
    const mercator_horizon  = getMercatorHorizon(transform);
    return {
        'u_sky_color': sky.properties.get('sky-color'),
        'u_horizon_color': sky.properties.get('horizon-color'),
        'u_horizon': [(transform.width / 2 - mercator_horizon * sin_roll)  * pixelRatio,
            (transform.height / 2 + mercator_horizon * cos_roll) * pixelRatio],
        'u_horizon_normal' : [-sin_roll, cos_roll],
        'u_sky_horizon_blend': (sky.properties.get('sky-horizon-blend') * transform.height / 2) * pixelRatio,
    };
};

export {skyUniforms, skyUniformValues};
