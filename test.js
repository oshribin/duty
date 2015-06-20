var assert = require( "assert" );
var duty = require( "./duty" );

describe( "Duty", function () {

    it( "returns the added job id and pending status", function () {
        var job = duty( "test", { hello: "world" } )
        assert( job.id );
        assert.equal( job.status, "pending" );
    });

    it( "fires an 'add' event when the job is added", function ( done ) {
        var before = new Date();
        var job = duty( "test", {} )
        job.on( "add", function () {
            var added_on = new Date( this.added_on );
            assert( added_on >= before );
            assert( added_on <= after );
            done();
        })
        var after = new Date();
    });

    it( "fires an 'error' event when the job wasn't added", function ( done ) {
        var db = duty.db();
        var save = db.Cursor.prototype._save;
        db.Cursor.prototype._save = function ( data, cb ) {
            cb( new Error( "Something went wrong" ) );
        }
        
        duty( "test", { hello: "world" } )
            .on( "error", function ( err ) {
                db.Cursor.prototype._save = save;
                assert.equal( err.message, "Something went wrong" )
                done();
            });
    })

    it( "queues jobs until a listener is registered", function ( done ) {
        var count = 0, all = [
            { hello: "world" },
            { foo: "bar" },
            { alice: "bob" }
        ];
        duty( "test", all[ 0 ] );
        duty( "test", all[ 1 ] );
        duty( "test", all[ 2 ] );
        duty.register( "test", function ( data, cb ) {
            assert.deepEqual( data, all[ count++ ] );
            cb();
            if ( count == 3 ) done();
        })
    });

    it( "pushes new jobs to existing listeners", function ( done ) {
        var count = 0, all = [
            { hello: "world" },
            { foo: "bar" },
            { alice: "bob" }
        ];
        duty.register( "test", function ( data, cb ) {
            assert.deepEqual( data, all[ count++ ] );
            cb();
            if ( count == 3 ) done();
        }, { delay: 10 } );
        setTimeout( function () {
            duty( "test", all[ 0 ] );
            duty( "test", all[ 1 ] );
            duty( "test", all[ 2 ] );
        }, 10 );
    });

    it( "unregister listeners", function ( done ) {
        duty.register( "test", function ( data, cb ) {
            done( new Error( "Unregistered listener invoked" ) )
        }, { delay: 10 } );
        duty.unregister( "test" );
        duty( "test", {} );
        setTimeout( done, 30 );
    })

    it( "overrides registered listeners", function ( done ) {
        duty.register( "test", function ( data, cb ) {
            done( new Error( "Unregistered listener invoked" ) )
        }, { delay: 10 } );
        duty.register( "test", function ( data, cb ) {
            done();
        }, { delay: 10 } );
        duty( "test", {} );
    });

    it( "get returns the job object", function ( done ) {
        duty( "test", { hello: "world" } )
            .on( "add", function () {
                var id = this.id;
                duty.get( id, function ( err, job ) {
                    assert.deepEqual( job.data, { hello: "world" } );
                    assert.equal( job.id, id );
                    done( err );
                })
            })
    });

    it( "stores job result", function ( done ) {
        var job = duty( "test", {} );
        duty.register( "test", function ( data, cb ) {
            cb( null, { ok: 1 } );
            setTimeout( function () {
                duty.get( job.id, function ( err, job ) {
                    assert.deepEqual( job.result, { ok: 1 } );
                    assert.equal( typeof job.error, "undefined" );
                    assert.equal( job.status, "success" );
                    assert( !isNaN( new Date( job.end_on ).getTime() ) )
                    done( err );
                })
            }, 20 );
        })
    });

    it( "stores job error", function ( done ) {
        var job = duty( "test", {} );
        duty.register( "test", function ( data, cb ) {
            cb( "Something went wrong", { ok: 1 } );
        })
        setTimeout( function () {
            duty.get( job.id, function ( err, job ) {
                assert.deepEqual( job.error, "Something went wrong" );
                assert.equal( typeof job.result, "undefined" );
                assert.equal( job.status, "error" );
                assert( !isNaN( new Date( job.end_on ).getTime() ) )
                done( err );
            })
        }, 20 );
    });

    it( "stores errors for sync thrown exceptions", function ( done ) {
        var job = duty( "test", {} )
        duty.register( "test", function () {
            throw new Error( "Something went wrong" )
        });
        setTimeout( function () {
            duty.get( job.id, function ( err, job ) {
                assert.deepEqual( job.error, "Error: Something went wrong" );
                assert.equal( typeof job.result, "undefined" );
                assert.equal( job.status, "error" );
                assert( !isNaN( new Date( job.end_on ).getTime() ) )
                done( err );
            })
        }, 20 );
    })

    it( "prevents duplicate processing of the same job", function ( done ) {
        var input = [];
        var job = duty( "test", {} );
        
        // start two listeners, while the second one will override the first,
        // both will still have access to the same job because the first 
        // listener will attempt to read at least one job before it's overridden
        // but will not have enough time to change its status
        var fn = function ( data, cb ) {
            input.push( data );
            cb();
        }

        duty.register( "test", fn );
        duty.register( "test", fn );

        setTimeout( function () {
            assert.equal( input.length, 1 );
            done();
        }, 20 )
    });

    it( "updates the progress", function ( done ) {
        var job = duty( "test", {} );
        duty.register( "test", function ( data, cb ) {
            this.emit( "progress", 10, 100 );
            setTimeout( cb, 10 );
        });

        setTimeout( function () {
            duty.get( job, function ( err, job ) {
                assert.equal( job.loaded, 10 );
                assert.equal( job.total, 100 );
                done( err )
            });
        }, 30 )
    });

    it( "cancels running jobs", function ( done ) {
        var job = duty( "test", {} );
        var count = 0, status;
        duty.register( "test", function ( data, cb ) {
            var interval = setInterval( function () {
                count += 1;
                this.emit( "progress" ); // force a job update
            }.bind( this ), 10 );

            // external error
            this.on( "error", function ( err ) {
                clearInterval( interval )
                assert.equal( err, "Canceled" );
                assert( count >= 1 && count <= 3, "1 <= " + count + " <= 3" );
                done();
            });
        });
        setTimeout( function () {
            duty.cancel( job, function ( err ) {
                if ( err ) done( err );
            });
        }, 20 );
    });

    it( "expires jobs after ttl", function ( done ) {
        var everror;
        var job = duty( "test", {} );
        duty.register( "test", function ( data, cb ) {
            this.on( "error", function ( err ) {
                everror = err;
            })
        }, { ttl: 20 } );

        setTimeout( function () {
            duty.get( job, function ( err, job ) {
                assert.equal( job.status, "error" );
                assert.equal( job.error, "Expired due to inactivity" );
                assert.equal( everror, "Expired due to inactivity" );
                done( err );
            })
        }, 30 )
    });

    it( "doesn't expire jobs when they complete on time", function ( done ) {
        var job = duty( "test", {} );
        duty.register( "test", function ( data, cb ) {
            setTimeout( cb, 5 );
        }, { ttl: 20 } );

        setTimeout( function () {
            duty.get( job, function ( err, job ) {
                assert.equal( job.status, "success" );
                done( err );
            })
        }, 30 )
    });

    // it( "runs listeners concurrently", function ( done ) {
    //     duty( "test", {});
    //     duty( "test", {});
    //     duty( "test", {});
    // })



    // remove all jobs before and after each test
    beforeEach( reset );
    afterEach( reset );
});

function reset( done ) {
    duty.unregister();
    var jobs = [];
    var Cursor = duty.db().Cursor;
    new Cursor()
        .find({})
        .on( "error", done )
        .on( "finish", done )
        .on( "data", jobs.push.bind( jobs ) )
        .on( "end", function () {
            jobs.forEach( this.remove.bind( this ) );
            this.end();
        })
}