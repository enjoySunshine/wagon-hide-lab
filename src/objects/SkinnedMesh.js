import { Mesh } from './Mesh.js';
import { Box3 } from '../math/Box3.js';
import { Matrix4 } from '../math/Matrix4.js';
import { Sphere } from '../math/Sphere.js';
import { Vector3 } from '../math/Vector3.js';
import { Vector4 } from '../math/Vector4.js';
import { Ray } from '../math/Ray.js';
import { AttachedBindMode, DetachedBindMode } from '../constants.js';
import { warn } from '../utils.js';

const _baseVector = /*@__PURE__*/ new Vector4();

const _skinIndex = /*@__PURE__*/ new Vector4();
const _skinWeight = /*@__PURE__*/ new Vector4();

const _vector4 = /*@__PURE__*/ new Vector4();
const _matrix4 = /*@__PURE__*/ new Matrix4();
const _vertex = /*@__PURE__*/ new Vector3();

const _sphere = /*@__PURE__*/ new Sphere();
const _inverseMatrix = /*@__PURE__*/ new Matrix4();
const _ray = /*@__PURE__*/ new Ray();

const _boneMatrix = /*@__PURE__*/ new Matrix4();

/**
 * A mesh that has a {@link Skeleton} that can then be used to animate the
 * vertices of the geometry with skinning/skeleton animation.
 *
 * Next to a valid skeleton, the skinned mesh requires skin indices and weights
 * as buffer attributes in its geometry. These attribute define which bones affect a single
 * vertex to a certain extend.
 *
 * Typically skinned meshes are not created manually but loaders like {@link GLTFLoader}
 * or {@link FBXLoader } import respective models.
 *
 * @augments Mesh
 * @demo scenes/bones-browser.html
 */
class SkinnedMesh extends Mesh {

	/**
	 * Constructs a new skinned mesh.
	 *
	 * @param {BufferGeometry} [geometry] - The mesh geometry.
	 * @param {Material|Array<Material>} [material] - The mesh material.
	 */
	constructor( geometry, material ) {

		super( geometry, material );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isSkinnedMesh = true;

		this.type = 'SkinnedMesh';

		/**
		 * `AttachedBindMode` means the skinned mesh shares the same world space as the skeleton.
		 * This is not true when using `DetachedBindMode` which is useful when sharing a skeleton
		 * across multiple skinned meshes.
		 *
		 * @type {(AttachedBindMode|DetachedBindMode)}
		 * @default AttachedBindMode
		 */
		this.bindMode = AttachedBindMode;

		/**
		 * The base matrix that is used for the bound bone transforms.
		 *
		 * @type {Matrix4}
		 */
		this.bindMatrix = new Matrix4();

		/**
		 * The base matrix that is used for resetting the bound bone transforms.
		 *
		 * @type {Matrix4}
		 */
		this.bindMatrixInverse = new Matrix4();

		/**
		 * The bounding box of the skinned mesh. Can be computed via {@link SkinnedMesh#computeBoundingBox}.
		 *
		 * @type {?Box3}
		 * @default null
		 */
		this.boundingBox = null;

		/**
		 * The bounding sphere of the skinned mesh. Can be computed via {@link SkinnedMesh#computeBoundingSphere}.
		 *
		 * @type {?Sphere}
		 * @default null
		 */
		this.boundingSphere = null;

		// CPU-side cache of the current skinned vertex positions in local space.
		// Bounding volumes, ray casting and vertex queries all read from this
		// cache so the skinning result is computed only once per unique
		// skeleton/morph state instead of once per vertex query.

		this._skinnedPositions = null;
		this._skinnedBoneMatrices = null;
		this._skinnedSignature = null;
		this._skinnedSignatureState = null;
		this._skinnedPositionsTrusted = false;

	}

	/**
	 * Computes the bounding box of the skinned mesh, and updates {@link SkinnedMesh#boundingBox}.
	 * The bounding box is not automatically computed by the engine; this method must be called by your app.
	 * If the skinned mesh is animated, the bounding box should be recomputed per frame in order to reflect
	 * the current animation state.
	 */
	computeBoundingBox() {

		const geometry = this.geometry;

		if ( this.boundingBox === null ) {

			this.boundingBox = new Box3();

		}

		this.boundingBox.makeEmpty();

		this._updateSkinnedPositionsIfNeeded();

		const positions = this._skinnedPositions;
		const count = geometry.getAttribute( 'position' ).count;

		const min = this.boundingBox.min;
		const max = this.boundingBox.max;

		for ( let i = 0; i < count; i ++ ) {

			const offset = i * 3;
			const x = positions[ offset ];
			const y = positions[ offset + 1 ];
			const z = positions[ offset + 2 ];

			min.x = Math.min( min.x, x );
			min.y = Math.min( min.y, y );
			min.z = Math.min( min.z, z );
			max.x = Math.max( max.x, x );
			max.y = Math.max( max.y, y );
			max.z = Math.max( max.z, z );

		}

	}

	/**
	 * Computes the bounding sphere of the skinned mesh, and updates {@link SkinnedMesh#boundingSphere}.
	 * The bounding sphere is automatically computed by the engine once when it is needed, e.g., for ray casting
	 * and view frustum culling. If the skinned mesh is animated, the bounding sphere should be recomputed
	 * per frame in order to reflect the current animation state.
	 */
	computeBoundingSphere() {

		const geometry = this.geometry;

		if ( this.boundingSphere === null ) {

			this.boundingSphere = new Sphere();

		}

		this.boundingSphere.makeEmpty();

		this._updateSkinnedPositionsIfNeeded();

		const positions = this._skinnedPositions;
		const count = geometry.getAttribute( 'position' ).count;

		const center = this.boundingSphere.center;

		for ( let i = 0; i < count; i ++ ) {

			const offset = i * 3;
			const x = positions[ offset ];
			const y = positions[ offset + 1 ];
			const z = positions[ offset + 2 ];

			const radius = this.boundingSphere.radius;

			if ( radius < 0 ) {

				// the sphere is still empty

				center.set( x, y, z );
				this.boundingSphere.radius = 0;

				continue;

			}

			const dx = x - center.x;
			const dy = y - center.y;
			const dz = z - center.z;

			const lengthSq = dx * dx + dy * dy + dz * dz;

			if ( lengthSq > ( radius * radius ) ) {

				// calculate the minimal sphere

				const length = Math.sqrt( lengthSq );

				const delta = ( length - radius ) * 0.5;
				const scale = delta / length;

				center.x += dx * scale;
				center.y += dy * scale;
				center.z += dz * scale;

				this.boundingSphere.radius = radius + delta;

			}

		}

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		this.bindMode = source.bindMode;
		this.bindMatrix.copy( source.bindMatrix );
		this.bindMatrixInverse.copy( source.bindMatrixInverse );

		this.skeleton = source.skeleton;

		this.boundingBox = source.boundingBox !== null ? source.boundingBox.clone() : null;
		this.boundingSphere = source.boundingSphere !== null ? source.boundingSphere.clone() : null;

		return this;

	}

	raycast( raycaster, intersects ) {

		const material = this.material;
		const matrixWorld = this.matrixWorld;

		if ( material === undefined ) return;

		// test with bounding sphere in world space

		if ( this.boundingSphere === null ) this.computeBoundingSphere();

		_sphere.copy( this.boundingSphere );
		_sphere.applyMatrix4( matrixWorld );

		if ( raycaster.ray.intersectsSphere( _sphere ) === false ) return;

		// convert ray to local space of skinned mesh

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		// test with bounding box in local space

		if ( this.boundingBox !== null ) {

			if ( _ray.intersectsBox( this.boundingBox ) === false ) return;

		}

		// test for intersections with geometry

		this._updateSkinnedPositionsIfNeeded();

		// the skinned positions are known to be up to date for the whole
		// intersection pass, so per-vertex queries can skip revalidation

		this._skinnedPositionsTrusted = true;

		try {

			this._computeIntersections( raycaster, intersects, _ray );

		} finally {

			this._skinnedPositionsTrusted = false;

		}

	}

	getVertexPosition( index, target ) {

		if ( this._skinnedPositionsTrusted === false ) {

			this._updateSkinnedPositionsIfNeeded();

		}

		const positions = this._skinnedPositions;
		const offset = index * 3;

		target.set( positions[ offset ], positions[ offset + 1 ], positions[ offset + 2 ] );

		return target;

	}

	/**
	 * Recomputes the cached skinned vertex positions when any input that
	 * affects them (skeleton pose, morph target influences, bind matrices or
	 * the geometry attributes) has changed since the last evaluation.
	 *
	 * @private
	 */
	_updateSkinnedPositionsIfNeeded() {

		if ( this._skinnedPositions === null || this._validateSkinnedPositions() === false ) {

			this._updateSkinnedPositions();

		}

	}

	/**
	 * Compares the current skinning inputs against the signature captured when
	 * the cached vertex positions were computed.
	 *
	 * @private
	 * @return {boolean} Whether the cached skinned vertex positions are still valid.
	 */
	_validateSkinnedPositions() {

		const state = this._skinnedSignatureState;

		if ( state === null ) return false;

		const geometry = this.geometry;
		const skeleton = this.skeleton;

		if ( skeleton === undefined || state.skeleton !== skeleton ) return false;

		const position = geometry.attributes.position;
		const skinIndex = geometry.attributes.skinIndex;
		const skinWeight = geometry.attributes.skinWeight;

		if ( state.positionArray !== position.array ||
			state.positionVersion !== position.version ||
			state.positionNormalized !== position.normalized ) return false;

		if ( state.skinIndexArray !== skinIndex.array ||
			state.skinIndexVersion !== skinIndex.version ||
			state.skinIndexNormalized !== skinIndex.normalized ) return false;

		if ( state.skinWeightArray !== skinWeight.array ||
			state.skinWeightVersion !== skinWeight.version ||
			state.skinWeightNormalized !== skinWeight.normalized ) return false;

		if ( state.morphTargetsRelative !== geometry.morphTargetsRelative ) return false;

		const morphAttributes = geometry.morphAttributes.position;
		const morphCount = morphAttributes !== undefined ? morphAttributes.length : 0;

		if ( state.morphCount !== morphCount ) return false;

		for ( let i = 0; i < morphCount; i ++ ) {

			const morphAttribute = morphAttributes[ i ];

			if ( state.morphArrays[ i ] !== morphAttribute.array ||
				state.morphVersions[ i ] !== morphAttribute.version ||
				state.morphNormalized[ i ] !== morphAttribute.normalized ) return false;

		}

		const influences = this.morphTargetInfluences;
		const influenceCount = influences !== undefined ? influences.length : 0;

		if ( state.influenceCount !== influenceCount ) return false;

		const bones = skeleton.bones;
		const boneInverses = skeleton.boneInverses;

		if ( state.boneCount !== bones.length || state.boneCount !== boneInverses.length ) return false;

		const signature = this._skinnedSignature;

		let k = 0;

		const bindMatrix = this.bindMatrix.elements;
		const bindMatrixInverse = this.bindMatrixInverse.elements;

		for ( let i = 0; i < 16; i ++ ) if ( signature[ k ++ ] !== bindMatrix[ i ] ) return false;
		for ( let i = 0; i < 16; i ++ ) if ( signature[ k ++ ] !== bindMatrixInverse[ i ] ) return false;

		for ( let b = 0, bl = bones.length; b < bl; b ++ ) {

			const elements = bones[ b ].matrixWorld.elements;

			for ( let i = 0; i < 16; i ++ ) if ( signature[ k ++ ] !== elements[ i ] ) return false;

		}

		for ( let b = 0, bl = boneInverses.length; b < bl; b ++ ) {

			const elements = boneInverses[ b ].elements;

			for ( let i = 0; i < 16; i ++ ) if ( signature[ k ++ ] !== elements[ i ] ) return false;

		}

		for ( let i = 0; i < influenceCount; i ++ ) if ( signature[ k ++ ] !== influences[ i ] ) return false;

		return true;

	}

	/**
	 * Stores the current skinning inputs so later queries can detect changes.
	 *
	 * @private
	 */
	_captureSkinnedSignature() {

		const geometry = this.geometry;
		const skeleton = this.skeleton;

		const position = geometry.attributes.position;
		const skinIndex = geometry.attributes.skinIndex;
		const skinWeight = geometry.attributes.skinWeight;

		const morphAttributes = geometry.morphAttributes.position;
		const morphCount = morphAttributes !== undefined ? morphAttributes.length : 0;

		const influences = this.morphTargetInfluences;
		const influenceCount = influences !== undefined ? influences.length : 0;

		const bones = skeleton.bones;
		const boneInverses = skeleton.boneInverses;

		let state = this._skinnedSignatureState;

		if ( state === null ) {

			state = this._skinnedSignatureState = {
				skeleton: null,
				positionArray: null, positionVersion: - 1, positionNormalized: false,
				skinIndexArray: null, skinIndexVersion: - 1, skinIndexNormalized: false,
				skinWeightArray: null, skinWeightVersion: - 1, skinWeightNormalized: false,
				morphTargetsRelative: false,
				morphCount: 0, morphArrays: [], morphVersions: [], morphNormalized: [],
				influenceCount: 0,
				boneCount: 0
			};

		}

		state.skeleton = skeleton;

		state.positionArray = position.array;
		state.positionVersion = position.version;
		state.positionNormalized = position.normalized;

		state.skinIndexArray = skinIndex.array;
		state.skinIndexVersion = skinIndex.version;
		state.skinIndexNormalized = skinIndex.normalized;

		state.skinWeightArray = skinWeight.array;
		state.skinWeightVersion = skinWeight.version;
		state.skinWeightNormalized = skinWeight.normalized;

		state.morphTargetsRelative = geometry.morphTargetsRelative;
		state.morphCount = morphCount;
		state.morphArrays.length = morphCount;
		state.morphVersions.length = morphCount;
		state.morphNormalized.length = morphCount;

		for ( let i = 0; i < morphCount; i ++ ) {

			const morphAttribute = morphAttributes[ i ];

			state.morphArrays[ i ] = morphAttribute.array;
			state.morphVersions[ i ] = morphAttribute.version;
			state.morphNormalized[ i ] = morphAttribute.normalized;

		}

		state.influenceCount = influenceCount;
		state.boneCount = bones.length;

		let signature = this._skinnedSignature;

		const size = 32 + bones.length * 32 + influenceCount;

		if ( signature === null || signature.length !== size ) {

			signature = this._skinnedSignature = new Float64Array( size );

		}

		let k = 0;

		const bindMatrix = this.bindMatrix.elements;
		const bindMatrixInverse = this.bindMatrixInverse.elements;

		for ( let i = 0; i < 16; i ++ ) signature[ k ++ ] = bindMatrix[ i ];
		for ( let i = 0; i < 16; i ++ ) signature[ k ++ ] = bindMatrixInverse[ i ];

		for ( let b = 0, bl = bones.length; b < bl; b ++ ) {

			const elements = bones[ b ].matrixWorld.elements;

			for ( let i = 0; i < 16; i ++ ) signature[ k ++ ] = elements[ i ];

		}

		for ( let b = 0, bl = boneInverses.length; b < bl; b ++ ) {

			const elements = boneInverses[ b ].elements;

			for ( let i = 0; i < 16; i ++ ) signature[ k ++ ] = elements[ i ];

		}

		for ( let i = 0; i < influenceCount; i ++ ) signature[ k ++ ] = influences[ i ];

	}

	/**
	 * Computes the skinned vertex positions of the whole mesh in a single pass
	 * and stores them in a flat array of xyz triplets in local space. The math
	 * is identical to evaluating {@link Mesh#getVertexPosition} and
	 * {@link SkinnedMesh#applyBoneTransform} per vertex, with the per-bone
	 * matrix products hoisted out of the vertex loop.
	 *
	 * @private
	 */
	_updateSkinnedPositions() {

		const geometry = this.geometry;
		const skeleton = this.skeleton;

		const positionAttribute = geometry.attributes.position;
		const skinIndexAttribute = geometry.attributes.skinIndex;
		const skinWeightAttribute = geometry.attributes.skinWeight;

		const morphAttributes = geometry.morphAttributes.position;
		const morphTargetsRelative = geometry.morphTargetsRelative;
		const morphInfluences = this.morphTargetInfluences;

		const count = positionAttribute.count;

		let positions = this._skinnedPositions;

		if ( positions === null || positions.length !== count * 3 ) {

			positions = this._skinnedPositions = new Float64Array( count * 3 );

		}

		// normalized attributes require per-component denormalization and are
		// evaluated through the generic per-vertex code path instead

		let fastPath = positionAttribute.normalized === false &&
			skinIndexAttribute.normalized === false &&
			skinWeightAttribute.normalized === false;

		if ( fastPath === true && morphAttributes !== undefined ) {

			for ( let i = 0, il = morphAttributes.length; i < il; i ++ ) {

				if ( morphAttributes[ i ].normalized === true ) {

					fastPath = false;
					break;

				}

			}

		}

		if ( fastPath === true ) {

			// hoist the per-bone products of the world and inverse bind matrices
			// out of the vertex loop

			const bones = skeleton.bones;
			const boneInverses = skeleton.boneInverses;

			let boneMatrices = this._skinnedBoneMatrices;

			if ( boneMatrices === null || boneMatrices.length !== bones.length * 16 ) {

				boneMatrices = this._skinnedBoneMatrices = new Float64Array( bones.length * 16 );

			}

			for ( let b = 0, bl = bones.length; b < bl; b ++ ) {

				_boneMatrix.multiplyMatrices( bones[ b ].matrixWorld, boneInverses[ b ] );
				boneMatrices.set( _boneMatrix.elements, b * 16 );

			}

			const positionArray = positionAttribute.array;
			const skinIndexArray = skinIndexAttribute.array;
			const skinWeightArray = skinWeightAttribute.array;

			const bindMatrix = this.bindMatrix.elements;
			const bindMatrixInverse = this.bindMatrixInverse.elements;

			const morphCount = morphAttributes !== undefined ? morphAttributes.length : 0;
			const morphArrays = [];

			for ( let i = 0; i < morphCount; i ++ ) {

				morphArrays.push( morphAttributes[ i ].array );

			}

			for ( let i = 0; i < count; i ++ ) {

				const i3 = i * 3;

				let x = positionArray[ i3 ];
				let y = positionArray[ i3 + 1 ];
				let z = positionArray[ i3 + 2 ];

				// morph targets

				if ( morphAttributes !== undefined && morphInfluences !== undefined ) {

					let mx = 0, my = 0, mz = 0;

					for ( let m = 0; m < morphCount; m ++ ) {

						const influence = morphInfluences[ m ];

						if ( influence === 0 ) continue;

						const morphArray = morphArrays[ m ];

						const tx = morphArray[ i3 ];
						const ty = morphArray[ i3 + 1 ];
						const tz = morphArray[ i3 + 2 ];

						if ( morphTargetsRelative ) {

							mx += tx * influence;
							my += ty * influence;
							mz += tz * influence;

						} else {

							mx += ( tx - x ) * influence;
							my += ( ty - y ) * influence;
							mz += ( tz - z ) * influence;

						}

					}

					x += mx;
					y += my;
					z += mz;

				}

				// skinning, matching applyBoneTransform()

				const bx = bindMatrix[ 0 ] * x + bindMatrix[ 4 ] * y + bindMatrix[ 8 ] * z + bindMatrix[ 12 ];
				const by = bindMatrix[ 1 ] * x + bindMatrix[ 5 ] * y + bindMatrix[ 9 ] * z + bindMatrix[ 13 ];
				const bz = bindMatrix[ 2 ] * x + bindMatrix[ 6 ] * y + bindMatrix[ 10 ] * z + bindMatrix[ 14 ];
				const bw = bindMatrix[ 3 ] * x + bindMatrix[ 7 ] * y + bindMatrix[ 11 ] * z + bindMatrix[ 15 ];

				let sx = 0, sy = 0, sz = 0;

				const i4 = i * 4;

				for ( let j = 0; j < 4; j ++ ) {

					const weight = skinWeightArray[ i4 + j ];

					if ( weight !== 0 ) {

						const o = skinIndexArray[ i4 + j ] * 16;

						sx += ( boneMatrices[ o ] * bx + boneMatrices[ o + 4 ] * by + boneMatrices[ o + 8 ] * bz + boneMatrices[ o + 12 ] * bw ) * weight;
						sy += ( boneMatrices[ o + 1 ] * bx + boneMatrices[ o + 5 ] * by + boneMatrices[ o + 9 ] * bz + boneMatrices[ o + 13 ] * bw ) * weight;
						sz += ( boneMatrices[ o + 2 ] * bx + boneMatrices[ o + 6 ] * by + boneMatrices[ o + 10 ] * bz + boneMatrices[ o + 14 ] * bw ) * weight;

					}

				}

				const w = 1 / ( bindMatrixInverse[ 3 ] * sx + bindMatrixInverse[ 7 ] * sy + bindMatrixInverse[ 11 ] * sz + bindMatrixInverse[ 15 ] );

				positions[ i3 ] = ( bindMatrixInverse[ 0 ] * sx + bindMatrixInverse[ 4 ] * sy + bindMatrixInverse[ 8 ] * sz + bindMatrixInverse[ 12 ] ) * w;
				positions[ i3 + 1 ] = ( bindMatrixInverse[ 1 ] * sx + bindMatrixInverse[ 5 ] * sy + bindMatrixInverse[ 9 ] * sz + bindMatrixInverse[ 13 ] ) * w;
				positions[ i3 + 2 ] = ( bindMatrixInverse[ 2 ] * sx + bindMatrixInverse[ 6 ] * sy + bindMatrixInverse[ 10 ] * sz + bindMatrixInverse[ 14 ] ) * w;

			}

		} else {

			// generic per-vertex fallback

			for ( let i = 0; i < count; i ++ ) {

				super.getVertexPosition( i, _vertex );
				this.applyBoneTransform( i, _vertex );

				const i3 = i * 3;

				positions[ i3 ] = _vertex.x;
				positions[ i3 + 1 ] = _vertex.y;
				positions[ i3 + 2 ] = _vertex.z;

			}

		}

		this._captureSkinnedSignature();

	}

	/**
	 * Binds the given skeleton to the skinned mesh.
	 *
	 * @param {Skeleton} skeleton - The skeleton to bind.
	 * @param {Matrix4} [bindMatrix] - The bind matrix. If no bind matrix is provided,
	 * the skinned mesh's world matrix will be used instead.
	 */
	bind( skeleton, bindMatrix ) {

		this.skeleton = skeleton;

		if ( bindMatrix === undefined ) {

			this.updateMatrixWorld( true );

			this.skeleton.calculateInverses();

			bindMatrix = this.matrixWorld;

		}

		this.bindMatrix.copy( bindMatrix );
		this.bindMatrixInverse.copy( bindMatrix ).invert();

	}

	/**
	 * This method sets the skinned mesh in the rest pose).
	 */
	pose() {

		this.skeleton.pose();

	}

	/**
	 * Normalizes the skin weights which are defined as a buffer attribute
	 * in the skinned mesh's geometry.
	 */
	normalizeSkinWeights() {

		const vector = new Vector4();

		const skinWeight = this.geometry.attributes.skinWeight;

		for ( let i = 0, l = skinWeight.count; i < l; i ++ ) {

			vector.fromBufferAttribute( skinWeight, i );

			const scale = 1.0 / vector.manhattanLength();

			if ( scale !== Infinity ) {

				vector.multiplyScalar( scale );

			} else {

				vector.set( 1, 0, 0, 0 ); // do something reasonable

			}

			skinWeight.setXYZW( i, vector.x, vector.y, vector.z, vector.w );

		}

	}

	updateMatrixWorld( force ) {

		super.updateMatrixWorld( force );

		if ( this.bindMode === AttachedBindMode ) {

			this.bindMatrixInverse.copy( this.matrixWorld ).invert();

		} else if ( this.bindMode === DetachedBindMode ) {

			this.bindMatrixInverse.copy( this.bindMatrix ).invert();

		} else {

			warn( 'SkinnedMesh: Unrecognized bindMode: ' + this.bindMode );

		}

	}

	/**
	 * Applies the bone transform associated with the given index to the given
	 * vector. Can be used to transform positions or direction vectors by providing
	 * a Vector4 with 1 or 0 in the w component respectively. Returns the updated vector.
	 *
	 * @param {number} index - The vertex index.
	 * @param {Vector3|Vector4} target - The target object that is used to store the method's result.
	 * @return {Vector3|Vector4} The updated vertex attribute data.
	 */
	applyBoneTransform( index, target ) {

		const skeleton = this.skeleton;
		const geometry = this.geometry;

		_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
		_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

		if ( target.isVector4 ) {

			_baseVector.copy( target );
			target.set( 0, 0, 0, 0 );

		} else {

			_baseVector.set( target.x, target.y, target.z, 1 );
			target.set( 0, 0, 0 );

		}

		_baseVector.applyMatrix4( this.bindMatrix );

		for ( let i = 0; i < 4; i ++ ) {

			const weight = _skinWeight.getComponent( i );

			if ( weight !== 0 ) {

				const boneIndex = _skinIndex.getComponent( i );

				_matrix4.multiplyMatrices( skeleton.bones[ boneIndex ].matrixWorld, skeleton.boneInverses[ boneIndex ] );

				target.addScaledVector( _vector4.copy( _baseVector ).applyMatrix4( _matrix4 ), weight );

			}

		}

		if ( target.isVector4 ) {

			// ensure the homogenous coordinate remains unchanged after vector operations
			target.w = _baseVector.w;

		}

		return target.applyMatrix4( this.bindMatrixInverse );

	}

}

export { SkinnedMesh };
