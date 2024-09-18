import Graph from './graph';
import { CustomResolver, fetchAggregator, shallowMerge } from './utils';

/**
 * The container class for Hyperdis. Hyperdis is an enabler for observable object with few interesting features like,
 * calculated property, next frame and same frame listeners, multiple listeners etc with a dependency resolving system.
 * It internally uses a graph to hold the hierarchial relationship of a object. Model is merely a container which
 * ties all the components together.
 *
 * @todo Circular dependency detection is not present
 *
 * @example check src/index.spec.js
 * @class
 */

class Model {
    // eslint-disable-next-line require-jsdoc
    constructor (options) {
        options = shallowMerge({}, { isPrintMode: false }, options);
        this._graph = new Graph(options);
        this._lockFlag = false;
        this._reqQ = [];
    }

    /**
     * Static method to create and init the model with an observable seed
     *
     * @param {Object} obj The target object which is required to be made observable
     * @return {Model} instance of the observable object model
     */
    static create (obj, options) {
        return new Model(options)._addPropInModel(null, obj);
    }

    /**
     * Appends more observable property on the already observable instance. This mutates the original model.
     *
     * This function works in two mode. One being
     * @param {String} mountPoint the property on which the new set of properties will be mounted. If its a nested
     *                          property then the mountPoint has to be written such a way so it feels like you are
     *                          accessing the object. If the mount point is not found then he obeservables are added in
     *                          the root.
     * @param {Object} The target object which is required to be made observable
     *
     * Another being
     * @param {Object} The target object which is required to be made observable
     *
     * @return {Model} instance of the observable object model
     */
    append (...params) {
        let mountPoint,
            obj;

        if (params.length === 1) {
            mountPoint = null;
            obj = params[0];
        } else {
            mountPoint = params[0];
            obj = params[1];
        }

        this._addPropInModel(mountPoint, obj);
        return this;
    }

    /**
     * Creates a calculated variable from existing variable. This variable can't be updated from outside.
     * @param {string} mountpoint property path on which the new variable will be placed
     * @param {string} name name of the variable. If the variable could have hierarchy like `limits.start`
     * @param {Function} fn funtion where the dependent variables are injected based on the dependency requirement
     */
    calculatedProp (...params) {
        let calculationConfig,
            customResolver,
            varName,
            mount,
            fetchFn;

        if (params.length > 2) {
            mount = params[0];
            varName = params[1];
            fetchFn = params[2];
        } else {
            mount = null;
            varName = params[0];
            fetchFn = params[1];
        }

        calculationConfig = fetchFn(fetchAggregator);
        customResolver = new CustomResolver(calculationConfig.fn);
        customResolver.addDependencies(...calculationConfig.dependencies);

        this._addPropInModel(mount, { [varName]: customResolver });
        return this;
    }

    // eslint-disable-next-line require-jsdoc
    _addPropInModel (mountPoint, obj) {
        this._graph.createNodesFrom(obj, mountPoint);
        return this;
    }

    /**
     * Register a listener in the current frame when a property or group of properties is changed.
     *
     * @example
     * This function takes a single or group of property and handler which is called when any of the properties are
     * changed.
     * When a single property is changed the handler is called with two parameter, what was the old value of the state
     * property and what is the new value.
     * myState.on('range.start', (oldValue, newValue) => {
     *      console.log('Value before prop change', oldValue);
     *      console.log('Value after prop change', newValue);
     * });
     *
     * myState.prop('range.start', 9);
     * // Output
     * Value before prop change 1
     * Value after prop change 9
     *
     * If a handler is registered on change of a property which has another state property as value, then the handler
     * gets called whenever any state property connected to it gets changed
     *
     * myState.on('range', (oldValue, newValue) => {
     *      console.log('Value before prop change', oldValue);
     *      console.log('Value after prop change', newValue);
     * });
     *
     * myState.prop('range.start', 10);
     * myState.prop('range.type.absolute', false);
     *
     * // Output
     * Value before prop change
     * range {
     *      start: 9,
     *      end: 5,
     *      type: {
     *          absolute: true
     *      }
     * }
     * Value after prop change
     * range: {
     *      start: 10,
     *      end: 5,
     *      type: {
     *          absolute: false
     *      }
     * }
     * If a handler is registered with more than one property change then, the handler is called when any of the
     * properties gets changed. In this cast the handler is called with more than one parameter: each for one state
     * property which is registered for listening. Each parameter is of type array containing [oldValue, newValue]
     *
     * myState.on('range.start', 'range.end', (start, end) => {
     *      console.log('Start', start);
     *      console.log('End', end);
     * });
     *
     * myState.prop('range.start', 12);
     *
     * // Output
     * Start [10, 12]
     * End [5, 5]
     *
     * myState.prop('range.end', 7);
     *
     * // Output
     * Start [12, 12]
     * End [5, 7]
     *
     * The on returns a function which is when called the listener registered gets unregistered
     *
     * let unsub = myState.on(['range.start', 'range.end'], (start, end) => {
     *      console.log('Start', start);
     *      console.log('End', end);
     * });
     *
     * // Unsubscribe
     * unsub()
     *
     * On takes an optional boolean value as the last parameter, which if passed as a true value the handler gets called
     * during registration itself.
     *
     * @param {Array.<String>} props List of properties which is of interest
     * @param {Function} fn Listener to be executed when any of them is changed. The listener is called with the old
     *                      value and new value of the properties
     * @param {*} instantCall When registered if the function is to be triggered with the value of the property
     *
     * @return {Function} function to unsubscribe from the listeners registry
     */
    on (props, fn, instantCall) {
        const
            propsArr = props instanceof Array ? props : [props],
            // All there listeners will be executed in the current stack frame
            unsub = this._graph.createElectricNodeOf(propsArr, {
                type: 'CurrFrame',
                fn
            });

        if (instantCall) {
            // Bar current next frame listeners from getting fired
            this._graph.stopPropagation().setPropagationOverride('nextFrame').resetNodeValue(...props);
        }
        return unsub;
    }

    /**
     * Register a listener for the next frame when a property or group of properties is changed.
     *
     * @example
     * See the examples for the on listener
     *
     * @param {Array.<String>} props List of properties which is of interest
     * @param {Function} fn Listener to be executed when any of them is changed. The listener is called with the old
     *                      value and new value of the properties. Here the oldvalue is last value of the last frame
     * @param {*} instantCall When registered if the function is to be triggered with the value of the property
     *
     * @return {Function} function to unsubscribe from the listeners registry
     */
    next (props, fn, instantCall) {
        const
            propsArr = props instanceof Array ? props : [props],
            // All there listeners will be executed at the tick of next animation frame
            unsub = this._graph.createElectricNodeOf(propsArr, {
                type: 'NextFrame',
                fn
            });

        // @todo check support for this from the graph side
        if (instantCall) {
            // Bar current frame listeners from getting fired
            this._graph.stopPropagation().setPropagationOverride('currentFrame').resetNodeValue(...props);
        }

        return unsub;
    }

    /**
     * Lock queues the request of property change and releases the change when unlock is called. This is helpful when
     * multiple property is getting called and the model listeners are to be fired once at the end of update.
     *
     * @return {Model} instance of the model
     */
    lock () {
        this._lockFlag = true;
        this._reqQ.length = 0;
        return this;
    }

    /**
     * Unlock unleashes the change done after the lock was called.

     * @return {Model} instance of the model
     */
    unlock () {
        this._lockFlag = false;
        this.setProp(this._reqQ);
        this._reqQ.length = 0;
        return this;
    }

    /**
     * This acts as getter and setter. If the function is called by passing only one argument, it retrieve the value
     * associated with the property. If the same function is called using two parameters, first one being the property
     * and second one being the value, then the value is set for the property and the handlers are called (if any)
     * which got registered using the on function
     *
     * Getter
     * @param {string} prop property path whose value to be retrieved
     * @return {Object} value of the property at the time of call
     *
     * Setter
     * @param {string} property property path whose value to be ser
     * @return {Model} instance of the model
     */
    prop (...params) {
        let prop,
            val,
            len;

        switch (len = params.length) {
        case 1:
            prop = params[0];
            break;

        case 2:
            prop = params[0];
            val = params[1];
            break;

        default:
            return this;
        }

        if (len === 2) {
            this._lockFlag ? this._reqQ.push([prop, val]) : this.setProp([[prop, val]]);
            return this;
        }

        return this._graph.getNodeValue(prop);
    }

    // eslint-disable-next-line require-jsdoc
    setProp (props) {
        // Filter out the calculated variables, so that it cant be changed from outside
        // @todo if a node is not leafValue, and change is called, ignore it too
        // props = props.filter(prop => !(VirtualObj.walkTill(prop[0].split('.'), this._vObj).leafValue()
        //     instanceof CalculatedVar));

        if (props.length === 0) {
            return this;
        }

        this._graph.update(props.map(prop => [this._graph.getNodeFromQualifiedName(prop[0]), prop[1]]));
        return this;
    }

    /**
     * Retrieves the graph representation of the object
     * @return {Graph} instance of the graph associated to the model
     */
    graph () {
        return this._graph;
    }

    /**
     * Get serialized data from the model
     *
     * @return {Object} Serialized data
     */
    serialize () {
        return this._graph.root.seed;
    }
}

export default Model;
