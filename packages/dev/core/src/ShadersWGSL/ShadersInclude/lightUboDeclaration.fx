#ifdef LIGHT{X}
	struct Light{X}
	{
		vLightData: vec4f,
		vLightDiffuse: vec4f,
		vLightSpecular: vec4f,
		#ifdef SPOTLIGHT{X}
			vLightDirection: vec4f,
			vLightFalloff: vec4f,
		#elif defined(POINTLIGHT{X})
			vLightFalloff: vec4f,
		#elif defined(HEMILIGHT{X})
			vLightGround: vec3f,
		#endif
		shadowsInfo: vec4f,
		depthValues: vec2f
	} ;

var<uniform> light{X} : Light{X};


#ifdef PROJECTEDLIGHTTEXTURE{X}
	uniform textureProjectionMatrix{X}: mat4x4f;
	var projectionLightSampler{X}: sampler;
#endif
#ifdef SHADOW{X}
	#ifdef SHADOWCSM{X}
		uniform lightMatrix{X}: mat4x4f[SHADOWCSMNUM_CASCADES{X}];
		uniform viewFrustumZ{X}: f32[SHADOWCSMNUM_CASCADES{X}];
        uniform frustumLengths{X}: f32[SHADOWCSMNUM_CASCADES{X}];
        uniform cascadeBlendFactor{X}: f32;

		varying vPositionFromLight{X}: vec4f[SHADOWCSMNUM_CASCADES{X}];
		varying vDepthMetric{X}: f32[SHADOWCSMNUM_CASCADES{X}];
		varying vPositionFromCamera{X}: vec4f;

		#if defined(SHADOWPCSS{X})
			var highp sampler2DArrayShadow shadowSampler{X};
			uniform highp sampler2DArray depthSampler{X};
            uniform lightSizeUVCorrection{X}: vec2f[SHADOWCSMNUM_CASCADES{X}];
            uniform depthCorrection{X}: f32[SHADOWCSMNUM_CASCADES{X}];
            uniform penumbraDarkness{X}: f32;
		#elif defined(SHADOWPCF{X})
			var highp sampler2DArrayShadow shadowSampler{X};
		#else
			var highp sampler2DArray shadowSampler{X};
		#endif

        #ifdef SHADOWCSMDEBUG{X}
            const vCascadeColorsMultiplier{X}: vec3f[8] = vec3f[8]
            (
                vec3 ( 1.5, 0.0, 0.0 ),
                vec3 ( 0.0, 1.5, 0.0 ),
                vec3 ( 0.0, 0.0, 5.5 ),
                vec3 ( 1.5, 0.0, 5.5 ),
                vec3 ( 1.5, 1.5, 0.0 ),
                vec3 ( 1.0, 1.0, 1.0 ),
                vec3 ( 0.0, 1.0, 5.5 ),
                vec3 ( 0.5, 3.5, 0.75 )
            );
            var shadowDebug{X}: vec3f;
        #endif

        #ifdef SHADOWCSMUSESHADOWMAXZ{X}
            var index{X}: i32 = -1;
        #else
            var index{X}: i32 = SHADOWCSMNUM_CASCADES{X} - 1;
        #endif

        var diff{X}: f32 = 0.;
	#elif defined(SHADOWCUBE{X})
		var shadowSampler{X}: sampler;		
	#else
		varying vPositionFromLight{X}: vec4f;
		varying vDepthMetric{X}: f32;

		#if defined(SHADOWPCSS{X})
			var shadowSampler{X}: sampler;
			var depthSampler{X}: sampler;
		#elif defined(SHADOWPCF{X})
			var shadowSampler{X}: sampler;
		#else
			var shadowSampler{X}: sampler;
		#endif
		uniform lightMatrix{X}: mat4x4f;
	#endif
#endif

#endif