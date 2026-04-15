import * as ts from 'typescript'
import type { Rule } from '../types'

/** Remove bare `console.log(...)` expression statements */
export const removeConsoleLogs: Rule = {
  name: 'remove-console-logs',
  description: 'Supprime les appels console.log',
  match: (node, sourceFile) => {
    if (!ts.isExpressionStatement(node)) return false
    const expr = node.expression
    if (!ts.isCallExpression(expr)) return false
    const access = expr.expression
    return (
      ts.isPropertyAccessExpression(access) &&
      ts.isIdentifier(access.expression) &&
      access.expression.text === 'console' &&
      access.name.text === 'log'
    )
  },
  replace: () => '',
}

/** Replace `any` type annotations with `unknown` */
export const replaceAnyWithUnknown: Rule = {
  name: 'replace-any-with-unknown',
  description: 'Remplace les annotations `any` par `unknown`',
  match: (node) => node.kind === ts.SyntaxKind.AnyKeyword,
  replace: () => 'unknown',
}

export const defaultRules: Rule[] = [removeConsoleLogs, replaceAnyWithUnknown]
