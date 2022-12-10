async function importFromTrello(inputs) {
  const trelloToPlankaLabels = {};

  const getTrelloLists = () => inputs.trelloBoard.lists.filter((list) => !list.closed);
  const getUsedTrelloLabels = () => {
    const result = {};
    inputs.trelloBoard.cards
      .map((card) => card.labels)
      .flat()
      .forEach((label) => {
        result[label.id] = label;
      });
    return Object.values(result);
  };
  const getTrelloCardsOfList = (listId) =>
    inputs.trelloBoard.cards.filter((l) => l.idList === listId && !l.closed);
  const getAllTrelloCheckItemsOfCard = (cardId) =>
    inputs.trelloBoard.checklists
      .filter((c) => c.idCard === cardId)
      .map((checklist) => checklist.checkItems)
      .flat();
  const getTrelloCommentsOfCard = (cardId) =>
    inputs.trelloBoard.actions.filter(
      (action) =>
        action.type === 'commentCard' &&
        action.data &&
        action.data.card &&
        action.data.card.id === cardId,
    );
  const getPlankaLabelColor = (trelloLabelColor) =>
    Label.COLORS.find((c) => c.indexOf(trelloLabelColor) !== -1) || 'desert-sand';

  const importComments = async (trelloCard, plankaCard) => {
    const trelloComments = getTrelloCommentsOfCard(trelloCard.id);
    trelloComments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return Promise.all(
      trelloComments.map(async (trelloComment) => {
        return sails.helpers.actions.createOne(
          {
            type: 'commentCard',
            data: {
              text:
                `${trelloComment.data.text}\n\n---\n*Note: imported comment, originally posted by ` +
                `\n${trelloComment.memberCreator.fullName} (${trelloComment.memberCreator.username}) on ${trelloComment.date}*`,
            },
          },
          inputs.user,
          plankaCard,
          inputs.request,
        );
      }),
    );
  };

  const importTasks = async (trelloCard, plankaCard) => {
    // TODO find workaround for tasks/checklist mismapping, see issue trello2planka#5
    return Promise.all(
      getAllTrelloCheckItemsOfCard(trelloCard.id).map(async (trelloCheckItem) => {
        return sails.helpers.tasks.createOne(
          {
            cardId: plankaCard.id,
            position: trelloCheckItem.pos,
            name: trelloCheckItem.name,
            isCompleted: trelloCheckItem.state === 'complete',
          },
          plankaCard,
          inputs.request,
        );
      }),
    );
  };

  const importCardLabels = async (trelloCard, plankaCard) => {
    return Promise.all(
      trelloCard.labels.map(async (trelloLabel) => {
        return sails.helpers.cardLabels.createOne(
          trelloToPlankaLabels[trelloLabel.id],
          plankaCard,
          inputs.request,
        );
      }),
    );
  };

  const importCards = async (trelloList, plankaList) => {
    return Promise.all(
      getTrelloCardsOfList(trelloList.id).map(async (trelloCard) => {
        const plankaCard = await sails.helpers.cards.createOne(
          {
            listId: plankaList.id,
            position: trelloCard.pos,
            name: trelloCard.name,
            description: trelloCard.desc || null,
          },
          inputs.user,
          inputs.board,
          plankaList,
          inputs.request,
        );

        await importCardLabels(trelloCard, plankaCard);
        await importTasks(trelloCard, plankaCard);
        await importComments(trelloCard, plankaCard);
        return plankaCard;
      }),
    );
  };

  const importLists = async () => {
    return Promise.all(
      getTrelloLists().map(async (trelloList) => {
        const plankaList = await sails.helpers.lists.createOne(
          {
            name: trelloList.name,
            position: trelloList.pos,
          },
          inputs.board,
          inputs.request,
        );
        return importCards(trelloList, plankaList);
      }),
    );
  };

  const importLabels = async () => {
    return Promise.all(
      getUsedTrelloLabels().map(async (trelloLabel) => {
        const plankaLabel = await sails.helpers.labels.createOne(
          {
            name: trelloLabel.name || null,
            color: getPlankaLabelColor(trelloLabel.color),
          },
          inputs.board,
          inputs.request,
        );
        trelloToPlankaLabels[trelloLabel.id] = plankaLabel;
      }),
    );
  };

  await importLabels();
  await importLists();
}

module.exports = {
  inputs: {
    user: {
      type: 'ref',
      required: true,
    },
    board: {
      type: 'ref',
      required: true,
    },
    trelloBoard: {
      type: 'json',
      required: true,
    },
    request: {
      type: 'ref',
    },
  },

  async fn(inputs) {
    await importFromTrello(inputs);

    return {
      board: inputs.board,
    };
  },
};
