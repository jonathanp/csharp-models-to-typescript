const path = require('path');
const camelcase = require('camelcase');

const flatten = arr => arr.reduce((a, b) => a.concat(b), []);

const arrayRegex = /^(.+)\[\]$/;
const simpleCollectionRegex = /^(?:I?List|IReadOnlyList|IEnumerable|ICollection|IReadOnlyCollection|HashSet)<([\w\d]+)>\??$/;
const collectionRegex = /^(?:I?List|IReadOnlyList|IEnumerable|ICollection|IReadOnlyCollection|HashSet)<(.+)>\??$/;
const simpleDictionaryRegex = /^(?:I?Dictionary|SortedDictionary|IReadOnlyDictionary)<([\w\d]+)\s*,\s*([\w\d]+)>\??$/;
const dictionaryRegex = /^(?:I?Dictionary|SortedDictionary|IReadOnlyDictionary)<([\w\d]+)\s*,\s*(.+)>\??$/;

const defaultTypeTranslations = {
    int: 'number',
    double: 'number',
    float: 'number',
    Int32: 'number',
    Int64: 'number',
    short: 'number',
    long: 'number',
    decimal: 'number',
    bool: 'boolean',
    DateTime: 'string',
    DateTimeOffset: 'string',
    Guid: 'string',
    dynamic: 'any',
    object: 'any',
};

const createConverter = config => {
    const typeTranslations = Object.assign({}, defaultTypeTranslations, config.customTypeTranslations);

    const convert = json => {
        const content = json.map(file => {
            const filename = path.relative(process.cwd(), file.FileName);

            const rows = flatten([
                ...file.Models.map(model => convertModel(model, filename)),
                ...file.Enums.map(enum_ => convertEnum(enum_, filename)),
            ]);

            return rows
                .map(row => config.namespace ? `    ${row}` : row)
                .join('\n');
        });

        const filteredContent = content.filter(x => x.length > 0);

        if (config.namespace) {
            return [
                `${config.exportedModule ? 'export' : 'declare'} module ${config.namespace} {`,
                ...filteredContent,
                '}',
            ].join('\n');
        } else {
            return filteredContent.join('\n');
        }
    };

    const convertModel = (model, filename) => {
        const rows = [];

        if (model.BaseClasses) {
            model.IndexSignature = model.BaseClasses.find(type => type.match(dictionaryRegex));
            model.BaseClasses = model.BaseClasses.filter(type => !type.match(dictionaryRegex));
        }

        const members = [...(model.Fields || []), ...(model.Properties || [])];
        const baseClasses = model.BaseClasses && model.BaseClasses.length ? ` extends ${model.BaseClasses.join(', ')}` : '';

        rows.push(`// ${filename}`);
        rows.push(`export interface ${model.ModelName}${baseClasses} {`);

        if (model.IndexSignature) {
            rows.push(`    ${convertIndexType(model.IndexSignature)};`);
        }

        members.forEach(member => {
            rows.push(`    ${convertProperty(member)};`);
        });

        rows.push(`}\n`);

        return rows;
    };

    const convertEnum = (enum_, filename) => {
        const rows = [];
        rows.push(`// ${filename}`);

        const entries = Object.entries(enum_.Values);

        const getEnumStringValue = (value) => config.camelCaseEnums
            ? camelcase(value)
            : value;

        if (config.stringLiteralTypesInsteadOfEnums) {
            rows.push(`export type ${enum_.Identifier} =`);

            entries.forEach(([key], i) => {
                const delimiter = (i === entries.length - 1) ? ';' : ' |';
                rows.push(`    '${getEnumStringValue(key)}'${delimiter}`);
            });

            rows.push('');
        } else {
            rows.push(`export enum ${enum_.Identifier} {`);

            entries.forEach(([key, value], i) => {
                if (config.numericEnums) {
                    rows.push(`    ${key} = ${value != null ? value : i},`);
                } else {
                    rows.push(`    ${key} = '${getEnumStringValue(key)}',`);
                }
            });

            rows.push(`}\n`);
        }

        return rows;
    };

    const convertProperty = property => {
        const optional = property.Type.endsWith('?');
        const identifier = convertIdentifier(optional ? `${property.Identifier.split(' ')[0]}?` : property.Identifier.split(' ')[0]);

        const type = parseType(property.Type);

        return `${identifier}: ${type}`;
    };

     const convertIndexType = indexType => {
       const dictionary = indexType.match(dictionaryRegex);
       const simpleDictionary = indexType.match(simpleDictionaryRegex);

       propType = simpleDictionary ? dictionary[2] : parseType(dictionary[2]);

       return `[key: ${convertType(dictionary[1])}]: ${convertType(propType)}`;
     };

    const convertRecord = indexType => {
        const dictionary = indexType.match(dictionaryRegex);
        const simpleDictionary = indexType.match(simpleDictionaryRegex);

        propType = simpleDictionary ? dictionary[2] : parseType(dictionary[2]);

        return `Record<${convertType(dictionary[1])}, ${convertType(propType)}>`;
    };

    const parseType = propType => {
        const array = propType.match(arrayRegex);
        if (array) {
            propType = array[1];
        }

        const collection = propType.match(collectionRegex);
        const dictionary = propType.match(dictionaryRegex);

        let type;

        if (collection) {
            const simpleCollection = propType.match(simpleCollectionRegex);
            propType = simpleCollection ? collection[1] : parseType(collection[1]);
            type = `${convertType(propType)}[]`;
        } else if (dictionary) {
            type = `${convertRecord(propType)}`;
        } else {
            const optional = propType.endsWith('?');
            type = convertType(optional ? propType.slice(0, propType.length - 1) : propType);
        }

        return array ? `${type}[]` : type;
    };

    const convertIdentifier = identifier => config.camelCase ? camelcase(identifier, config.camelCaseOptions) : identifier;
    const convertType = type => type in typeTranslations ? typeTranslations[type] : type;

    return convert;
};

module.exports = createConverter;
