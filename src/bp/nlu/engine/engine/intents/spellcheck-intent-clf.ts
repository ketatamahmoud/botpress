import Joi, { validate } from 'Joi'
import _ from 'lodash'
import { ModelLoadingError } from '../../errors'
import { SpellChecker } from '../language/spell-checker'
import Utterance from '../utterance/utterance'
import { NoneableIntentClassifier, NoneableIntentPredictions } from './intent-classifier'
import { NONE_INTENT, OOSTrainInput } from './oos-intent-classfier'

interface Model {
  innerClfmodel: string
}

interface Predictors {
  innerClf: NoneableIntentClassifier
}

interface SpellCheckPredictions extends NoneableIntentPredictions {
  spellChecked: string
}

export const modelSchema = Joi.object()
  .keys({
    innerClfmodel: Joi.string()
      .allow('')
      .required()
  })
  .required()

export class SpellCheckIntentClassifier implements NoneableIntentClassifier {
  private static _displayName = 'Spell-check Intent Classifier'
  private static _name = 'spellcheck-classifier'

  private model: Model | undefined
  private predictors: Predictors | undefined

  constructor(private innerClf: NoneableIntentClassifier) {}

  async train(trainInput: OOSTrainInput, progress: (p: number) => void) {
    await this.innerClf.train(trainInput, progress)
    this.model = {
      innerClfmodel: this.innerClf.serialize()
    }
  }

  serialize() {
    if (!this.model) {
      throw new Error(`${SpellCheckIntentClassifier._displayName} must be trained before calling serialize.`)
    }
    return JSON.stringify(this.model)
  }

  async load(serialized: string) {
    try {
      const raw = JSON.parse(serialized)
      const model: Model = await validate(raw, modelSchema)
      this.predictors = await this._makePredictors(model)
      this.model = model
    } catch (err) {
      throw new ModelLoadingError(SpellCheckIntentClassifier._displayName, err)
    }
  }

  private _makePredictors = async (model: Model): Promise<Predictors> => {
    await this.innerClf.load(model.innerClfmodel)
    return {
      innerClf: this.innerClf
    }
  }

  async predict(utterance: Utterance): Promise<NoneableIntentPredictions> {
    if (!this.predictors) {
      if (!this.model) {
        throw new Error(`${SpellCheckIntentClassifier._displayName} must be trained before calling predict.`)
      }

      this.predictors = await this._makePredictors(this.model)
    }

    const { spellChecked } = utterance
    if (spellChecked.toString() !== utterance.toString()) {
      const prediction = await this.predictors.innerClf.predict(utterance)
      const spellCheckedPrediction = await this.predictors.innerClf.predict(spellChecked)
      return this._mergeSpellChecked(prediction, spellCheckedPrediction)
    }
    return this.predictors.innerClf.predict(utterance)
  }

  private _mergeSpellChecked = (
    originalPredictions: NoneableIntentPredictions,
    spellCheckedPredictions: NoneableIntentPredictions
  ): NoneableIntentPredictions => {
    const mostConfidentIntent = (preds: NoneableIntentPredictions) =>
      _(preds.intents)
        .filter(i => i.name !== NONE_INTENT)
        .maxBy(i => i.confidence)!

    const mergedPrediction = _.cloneDeep(originalPredictions)

    if (
      originalPredictions.intents.length &&
      mostConfidentIntent(originalPredictions).confidence <= mostConfidentIntent(spellCheckedPredictions).confidence
    ) {
      for (const intent of mergedPrediction.intents) {
        const originalIntent = originalPredictions.intents.find(i => i.name === intent.name)!
        const spellCheckedIntent = spellCheckedPredictions.intents.find(i => i.name === intent.name)!
        intent.confidence = _.max([originalIntent.confidence, spellCheckedIntent.confidence])!
      }
    }

    mergedPrediction.oos = spellCheckedPredictions.oos
    return mergedPrediction
  }
}
