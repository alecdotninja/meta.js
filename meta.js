#!/usr/bin/env node
var esprima = require('esprima');
var estraverse = require('estraverse');
var escodegen = require('escodegen');
var esmangle = require('esmangle');

var Syntax = esprima.Syntax;

var cloneNode = function(node) {
	var cloneNode = {};
	for(var key in node) if(node.hasOwnProperty(key)) cloneNode[key] = node[key];
	return cloneNode;
};

var mutateNode = function(node, newNode) {
	for(var key in node) if(node.hasOwnProperty(key)) delete node[key];
	for(var key in newNode) if(newNode.hasOwnProperty(key)) node[key] = newNode[key];
	return node;
};
		
var Scope = function Scope(parentScope, sourceNode) {
	var scope = Object.create(Scope.prototype);
	scope.parentScope = parentScope;
	scope.declaredVariables = [];
	scope.referancedVariables = [];
	scope.sourceNode = sourceNode;
	return scope;
};


Scope.prototype = {
	declare: function(variableName) {
		if(this.declaredVariables.indexOf(variableName) === -1) {
			this.declaredVariables.push(variableName);
		}
	},
	referance: function(variableName) {
		if(this.referancedVariables.indexOf(variableName) === -1) {
			this.referancedVariables.push(variableName);
		}
	},
	getHolds: function() {
		return this.referancedVariables.filter(function(variableName) {
			return variableName !== 'arguments' && this.declaredVariables.indexOf(variableName) === -1;
		}.bind(this));
	}
};
	
var metaify = function(ast) {
	var currentScope = null;
	
	var functionDeclarationNodes = [];
	var functionExpressionNodes = [];
	
	estraverse.traverse(ast, {
		enter: function enter(node, parentNode) {
			node.parentNode = parentNode || null;
			
			if(node.type === Syntax.FunctionExpression || node.type === Syntax.FunctionDeclaration) {
				currentScope = Scope(currentScope, node);
				node.scope = currentScope;
			}
			
			switch (node.type) {
				case Syntax.FunctionDeclaration:
					node.id.scope = currentScope.parentScope || null;
					
					if(currentScope.parentScope) {
						currentScope.parentScope.declare(node.id.name);
					}
					
					node.params.forEach(function(node) {
						node.scope = currentScope;
						currentScope.declare(node.name);
					});
					
					functionDeclarationNodes.push(node);
					break;
				case Syntax.FunctionExpression:
					if(node.id) {
						node.id.scope = currentScope;
						currentScope.declare(node.id.name);
					}
					
					node.params.forEach(function(node) {
						node.scope = currentScope;
						currentScope.declare(node.name);
					});
					
					functionExpressionNodes.push(node);
					break;
				case Syntax.Identifier:
					if(currentScope && node.scope === undefined) {
						currentScope.referance(node.name);
					}
					break;
				case Syntax.MemberExpression:
					if(!node.computed && node.property.type === Syntax.Identifier) {
						node.property.scope = null;
					}
					break;
				case Syntax.ObjectExpression:
					node.properties.forEach(function(property) {
						if(property.key.type === Syntax.Identifier) {
							property.key.scope = null;
						}
					});
					break;
				case Syntax.VariableDeclaration:
					if(currentScope) {
						node.declarations.forEach(function(node) {
							node.scope = currentScope;
							currentScope.declare(node.id.name);
						});	
					}
					break;
				default:
					break;
			}
		},
		leave: function leave(node) {
			if(node.type === Syntax.FunctionExpression || node.type === Syntax.FunctionDeclaration) {
				currentScope = currentScope.parentScope;
			}
		}
	});
	
	if(currentScope !== null) {
		throw new Error('Something went wrong! (unclosed scope)');
	}
	
	functionDeclarationNodes.forEach(function(node) {
		if(node.scope.parentScope && node.scope.getHolds().length > 0) {
			var offset = node.parentNode.body.indexOf(node);
			node.parentNode.body.splice(offset, 1);
			node.parentNode.body.splice(0, 0, node);
			
			var functionExpressionNode = cloneNode(node);
			functionExpressionNode.type = Syntax.FunctionExpression;
			functionExpressionNode.id = null;
			
			mutateNode(node, {
				type: Syntax.VariableDeclaration,
				kind: 'var',
				declarations: [{
					type: Syntax.VariableDeclarator,
					id: node.id,
					init: functionExpressionNode
				}]
			});
			
			functionExpressionNodes.push(functionExpressionNode);
		}			
	});
	
	functionExpressionNodes.forEach(function(node) {
		/*
		if(node.body) {
			if(!node.id) { // ensure that the lambda is named
				node.id = {
					type: Syntax.Identifier,
					name: '__thisFn__'
				}
			}
			
			var replacementBlock = {
				type: Syntax.BlockStatement,
				body: [{
					type: Syntax.ExpressionStatement,
					expression: {
						type: Syntax.AssignmentExpression,
						operator: '=',
						left: {
							type: Syntax.MemberExpression,
							computed: false,
							object: {
								type: Syntax.Identifier,
								name: node.id.name
							},
							property: {
								type: Syntax.Identifier,
								name: 'context'
							}
						},
						right: {
							type: Syntax.ThisExpression
						}
					}
				}, {
					type: Syntax.TryStatement,
					block: cloneNode(node.body),
					finalizer: {
						type: Syntax.BlockStatement,
						body: [{
							type: Syntax.ExpressionStatement,
							expression: {
								type: Syntax.AssignmentExpression,
								operator: '=',
								left: {
									type: Syntax.MemberExpression,
									computed: false,
									object: {
										type: Syntax.Identifier,
										name: node.id.name
									},
									property: {
										type: Syntax.Identifier,
										name: 'context'
									}
								},
								right: {
									type: Syntax.Literal,
									value: null
								}
							}
						}]
					},
					guardedHandlers: [],
					handlers: []
				}]
			}
			
			if(node.scope.declaredVariables.length > 0) { // get access to the local variables (only if there are any)
				replacementBlock.body.unshift({
					type: Syntax.ExpressionStatement,
					expression: {
						type: Syntax.AssignmentExpression,
						operator: '=',
						left: {
							type: Syntax.MemberExpression,
							computed: false,
							object: {
								type: Syntax.Identifier,
								name: node.id.name
							},
							property: {
								type: Syntax.Identifier,
								name: 'getLocals'
							}
						},
						right: {
							type: Syntax.FunctionExpression,
							id: null,
							params: [],
							defaults: [],
							body: {
								type: Syntax.BlockStatement,
								body: [{
									type: Syntax.ReturnStatement,
									argument: {
										type: Syntax.ObjectExpression,
										properties: node.scope.declaredVariables.map(function(variableName) {
											return {
												type: Syntax.Property,
												key: {
													type: Syntax.Literal,
													value: variableName
												},
												value: {
													type: Syntax.Identifier,
													name: variableName
												}
											};
										})
									}
								}]
							}
						}
					}
				});
				
				replacementBlock.body[2].finalizer.body.unshift({
					type: Syntax.ExpressionStatement,
					expression: {
						type: Syntax.AssignmentExpression,
						operator: '=',
						left: {
							type: Syntax.MemberExpression,			
							computed: false,
							object: {
								type: Syntax.Identifier,
								name: node.id.name
							},
							property: {
								type: Syntax.Identifier,
								name: 'getLocals'
							}
						},
						right: {
							type: Syntax.Literal,
							value: null
						}
					}
				});
			}
			
			mutateNode(node.body, replacementBlock);
		}
		*/
		var functionName = (node.id && node.id.name) || '__meta' + (+new Date()) + '__';
		
		if(node.scope.parentScope && node.scope.getHolds().length > 0) {
			mutateNode(node, {
				type: Syntax.CallExpression,
				callee: {
					type: Syntax.FunctionExpression,
					id: null,
					params: [{
						type: Syntax.Identifier,
						name: functionName
					}],
					defaults: [],
					body: {
						type: Syntax.BlockStatement,
						body: [{
							type: Syntax.ExpressionStatement,
							expression: {
								type: Syntax.AssignmentExpression,
								operator: '=',
								left: {
									type: Syntax.MemberExpression,
									computed: false,
									object: {
										type: Syntax.Identifier,
										name: functionName
									},
									property: {
										type: Syntax.Identifier,
										name: 'getClosure'
									}
								},
								right: {
									type: Syntax.FunctionExpression,
									id: null,
									params: [],
									defaults: [],
									body: {
										type: Syntax.BlockStatement,
										body: [{
											type: Syntax.ReturnStatement,
											argument: {
												type: Syntax.ObjectExpression,
												properties: node.scope.getHolds().map(function(variableName) {
													return {
														type: Syntax.Property,
														key: {
															type: Syntax.Literal,
															value: variableName
														},
														value: {
															type: Syntax.Identifier,
															name: variableName
														}
													};
												})
											}
										}]
									}
								}
							}
						}, {
							type: Syntax.ReturnStatement,
							argument: {
								type: Syntax.Identifier,
								name: functionName
							}
						}]
					},
					rest: null,
					generator: false,
					expression: false
				},
				arguments: [cloneNode(node)]
			});			
		}
	});
	
	estraverse.traverse(ast, {
		enter: function(node) {
			if('parentNode' in node) delete node.parentNode;
			if('scope' in node) delete node.scope;
		}
	});
	
	return ast;
};

var transformSource = function(source) {
	var ast = esprima.parse(source);
	ast = metaify(ast);
	ast = esmangle.optimize(ast);
	ast = esmangle.mangle(ast);
	return escodegen.generate(ast, {
    format: {
			indent: {
				style: ''
			},
			quotes: 'auto',
			compact: true
    }
	});
};

if(process.stdin.isTTY) {
	process.stdout.write('meta.js Compiler v0.0.1.0\n  Usage: [[input]] | ' + __filename + ' | [[output]]\n\n');
}else{
	var sourceInput = '';
	
	process.stdin.setEncoding('utf-8');
	process.stdin.resume();
	process.stdin.on('data', function(source) {
		sourceInput += source;
	});	
	
	process.stdin.on('end', function() {
		try {
			var transformedSource = transformSource(sourceInput);
			process.stdout.write('\/\/ Compiled by meta.js v0.0.1.0\n');
			process.stdout.write(transformedSource);
		}catch(processingError){
			process.stderr.write('\n' + processingError.toString() + '\n');
			process.exit(1);
		}
	});
}