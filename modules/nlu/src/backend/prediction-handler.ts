import * as sdk from 'botpress/sdk'
import { ModelId, ModelIdService, Engine, Model } from 'common/nlu/engine'
import _ from 'lodash'

import ModelService from './model-service'

type WithoutIncludedContexts = Omit<sdk.IO.EventUnderstanding, 'includedContexts'>
type WithoutDetectedLanguage = Omit<WithoutIncludedContexts, 'detectedLanguage'>

export class PredictionHandler {
  constructor(
    private modelsByLang: _.Dictionary<ModelId>,
    private modelService: ModelService,
    private modelIdService: ModelIdService,
    private engine: Engine,
    private anticipatedLanguage: string,
    private defaultLanguage: string,
    private logger: sdk.Logger
  ) {}

  async predict(textInput: string): Promise<WithoutIncludedContexts> {
    const modelCacheState = _.mapValues(this.modelsByLang, model => ({ model, loaded: this.engine.hasModel(model) }))

    const missingModels = _(modelCacheState)
      .pickBy(mod => !mod.loaded)
      .mapValues(({ model }) => model)
      .value()

    if (Object.keys(missingModels).length) {
      const formattedMissingModels = JSON.stringify(missingModels, undefined, 2)
      this.logger.warn(
        `About to detect language, but the following models are not loaded: \n${formattedMissingModels}\nMake sure you have enough cache space to fit all models for your bot.`
      )
    }

    const loadedModels = _(modelCacheState)
      .pickBy(mod => mod.loaded)
      .mapValues(({ model }) => model)
      .value()

    let detectedLanguage: string | undefined
    try {
      detectedLanguage = await this.engine.detectLanguage(textInput, loadedModels)
    } catch (err) {
      let msg = `An error occured when detecting language for input "${textInput}"\n`
      msg += `Falling back on default language: ${this.defaultLanguage}.`
      this.logger.attachError(err).error(msg)
    }

    let nluResults: WithoutDetectedLanguage | undefined

    const languagesToTry = _([detectedLanguage, this.anticipatedLanguage, this.defaultLanguage])
      .filter(l => !_.isUndefined(l))
      .uniq()
      .value()

    for (const lang of languagesToTry) {
      nluResults = await this.tryPredictInLanguage(textInput, lang)
      if (!this.isEmptyOrError(nluResults)) {
        break
      }
    }

    if (this.isEmptyOrError(nluResults)) {
      throw new Error(`No model found for the following languages: ${languagesToTry}`)
    }

    return { ...nluResults, detectedLanguage }
  }

  private async tryPredictInLanguage(textInput: string, language: string): Promise<WithoutDetectedLanguage> {
    if (!this.modelsByLang[language] || !this.engine.hasModel(this.modelsByLang[language])) {
      const model = await this.fetchModel(language)
      if (!model) {
        return
      }
      this.modelsByLang[language] = this.modelIdService.toId(model)
      await this.engine.loadModel(model)
    }

    const t0 = Date.now()
    try {
      const originalOutput = await this.engine.predict(textInput, this.modelsByLang[language])
      const ms = Date.now() - t0

      return { ...originalOutput, errored: false, language, ms }
    } catch (err) {
      const stringId = this.modelIdService.toString(this.modelsByLang[language])
      const msg = `An error occured when predicting for input "${textInput}" with model ${stringId}`
      this.logger.attachError(err).error(msg)

      const ms = Date.now() - t0
      return { errored: true, language, ms }
    }
  }

  private fetchModel(languageCode: string): Promise<Model> {
    const modelId = this.modelsByLang[languageCode]
    if (modelId) {
      return this.modelService.getModel(modelId)
    }

    const specifications = this.engine.getSpecifications()
    const query = this.modelIdService.briefId({ specifications, languageCode })
    return this.modelService.getLatestModel(query)
  }

  private isEmptyOrError(nluResults: WithoutDetectedLanguage | undefined) {
    return !nluResults || nluResults.errored
  }
}
