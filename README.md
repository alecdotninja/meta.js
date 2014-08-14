# Meta.js

Meta.js is a source transformation tool that makes meta-programming in JavaScript a little more awesome.

## Features

* Adds the method ```getClosure``` to all functions that retrieves the value of all variables it encloses.

## TO-DO

* Ability to bind a function to an arbitrary scope
* Better stack traces (with local bindings)
* Function hooking
* Better compiler

## Usage

At the moment, the compiler can only be used with streams. It takes JavaScript source on ```stdin``` and writes to ```stdout``` (any errors are written to ```stderr```).

```bash
$ cat input1.js input2.js input3.js | ./meta.js > output.meta.js
```