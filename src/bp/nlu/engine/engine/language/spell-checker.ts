import _ from 'lodash'
import { isWord } from '../tools/token-utils'
import { getClosestSpellingToken } from '../tools/vocab'
import Utterance, { UtteranceToken } from '../utterance/utterance'
import { POSClass } from './pos-tagger'

interface AlternateToken {
  value: string
  vector: number[] | ReadonlyArray<number>
  POS: POSClass
  isAlter?: boolean
}

export class SpellChecker {
  constructor(private vocab: { [token: string]: number[] }) {}

  public predict(utterance: Utterance): Utterance | null {
    return _.chain(utterance.tokens)
      .map(token => {
        const strTok = token.toString({ lowerCase: true })
        if (!token.isWord || this.vocab[strTok] || !_.isEmpty(token.entities)) {
          return this._uttTok2altTok(token)
        }

        const closestToken = getClosestSpellingToken(strTok, Object.keys(this.vocab))

        if (this._isClosestTokenValid(token, closestToken)) {
          const altToken: AlternateToken = {
            value: closestToken,
            POS: token.POS,
            vector: this.vocab[closestToken],
            isAlter: true
          }
          return altToken
        } else {
          return this._uttTok2altTok(token)
        }
      })
      .thru((altToks: AlternateToken[]) => {
        const hasAlternate = altToks.length === utterance.tokens.length && altToks.some(t => t.isAlter)
        if (hasAlternate) {
          return new Utterance(
            altToks.map(t => t.value),
            altToks.map(t => <number[]>t.vector),
            altToks.map(t => t.POS),
            utterance.languageCode
          )
        }
        return null
      })
      .value()
  }

  private _isClosestTokenValid(originalToken: UtteranceToken, closestToken: string): boolean {
    return isWord(closestToken) && originalToken.value.length > 3 && closestToken.length > 3
  }

  private _uttTok2altTok(token: UtteranceToken): AlternateToken {
    return {
      ..._.pick(token, ['vector', 'POS']),
      value: token.toString(),
      isAlter: false
    }
  }
}
